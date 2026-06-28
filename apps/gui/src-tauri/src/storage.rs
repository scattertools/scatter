// Native Rust reimplementation of the TypeScript node's ShardStorage
// (apps/node/src/storage.ts). The on-disk layout and the shard-index.json
// format match byte-for-byte so shards written here are interchangeable with
// the TS daemon and vice-versa.
//
// Layout:
//   <root>/shards/<fileId[0..2]>/<fileId>_<shardIndex>.bin
//   <root>/shard-index.json  -> { version, usedBytes, shardCount, sizes }
//
// usedBytes / shardCount are O(1) reads off the in-memory index, which is
// persisted atomically (write to .tmp then rename). Missing/corrupt index is
// rebuilt by walking the shards directory.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const INDEX_VERSION: u64 = 1;

#[derive(Clone)]
struct ShardIndex {
    used_bytes: u64,
    shard_count: u64,
    // per-shard sizes keyed by `${fileId}_${shardIndex}`
    sizes: BTreeMap<String, u64>,
}

impl Default for ShardIndex {
    fn default() -> Self {
        Self {
            used_bytes: 0,
            shard_count: 0,
            sizes: BTreeMap::new(),
        }
    }
}

/// Raw shape parsed from / written to shard-index.json.
#[derive(Serialize, Deserialize)]
struct IndexFile {
    #[serde(default)]
    version: u64,
    #[serde(rename = "usedBytes")]
    used_bytes: u64,
    #[serde(rename = "shardCount")]
    shard_count: u64,
    sizes: BTreeMap<String, u64>,
}

/// Shard storage backed by the on-disk layout described above.
///
/// All public methods perform blocking filesystem I/O and are intended to be
/// called from a blocking context (e.g. `tokio::task::spawn_blocking`). The
/// type is cheap to clone via `Arc` and guards its mutable index with a plain
/// `std::sync::Mutex` (never held across an await).
pub struct ShardStorage {
    root: PathBuf,
    capacity_bytes: u64,
    index: std::sync::Mutex<ShardIndex>,
}

impl ShardStorage {
    pub fn new(root: PathBuf, capacity_bytes: u64) -> Self {
        Self {
            root,
            capacity_bytes,
            index: std::sync::Mutex::new(ShardIndex::default()),
        }
    }

    pub fn shards_dir(&self) -> PathBuf {
        self.root.join("shards")
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("shard-index.json")
    }

    fn shard_path(&self, file_id: &str, shard_index: u32) -> PathBuf {
        let prefix: String = file_id.chars().take(2).collect();
        self.shards_dir()
            .join(prefix)
            .join(format!("{file_id}_{shard_index}.bin"))
    }

    fn key(file_id: &str, shard_index: u32) -> String {
        format!("{file_id}_{shard_index}")
    }

    /// Create the shards dir and load (or rebuild) the index.
    pub fn init(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(self.shards_dir())?;
        self.load_index();
        Ok(())
    }

    /// Load the persisted index and trust it. If missing or corrupt, rebuild
    /// by walking the shards directory.
    fn load_index(&self) {
        if let Ok(raw) = std::fs::read_to_string(self.index_path()) {
            if let Ok(parsed) = serde_json::from_str::<IndexFile>(&raw) {
                let mut guard = self.index.lock().unwrap();
                *guard = ShardIndex {
                    used_bytes: parsed.used_bytes,
                    shard_count: parsed.shard_count,
                    sizes: parsed.sizes,
                };
                return;
            }
        }
        // missing or corrupt -> rebuild
        self.rebuild_index();
    }

    /// Walk the shards directory once and rebuild the in-memory index, then
    /// persist it.
    fn rebuild_index(&self) {
        let mut rebuilt = ShardIndex::default();
        walk_dir(&self.shards_dir(), &mut |path, size| {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            let key = name.strip_suffix(".bin").unwrap_or(name).to_string();
            rebuilt.sizes.insert(key, size);
            rebuilt.used_bytes += size;
            rebuilt.shard_count += 1;
        });
        {
            let mut guard = self.index.lock().unwrap();
            *guard = rebuilt;
        }
        self.persist_index();
    }

    /// Persist the index atomically (write to a temp file then rename).
    fn persist_index(&self) {
        let payload = {
            let guard = self.index.lock().unwrap();
            IndexFile {
                version: INDEX_VERSION,
                used_bytes: guard.used_bytes,
                shard_count: guard.shard_count,
                sizes: guard.sizes.clone(),
            }
        };
        if let Ok(json) = serde_json::to_string(&payload) {
            let index_path = self.index_path();
            let tmp = self.root.join("shard-index.json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &index_path);
            }
        }
    }

    /// Store a shard, verifying its SHA-256 against `expected_hash` before
    /// writing and enforcing the capacity limit on the net delta.
    pub fn store(
        &self,
        file_id: &str,
        shard_index: u32,
        data: &[u8],
        expected_hash: &str,
    ) -> Result<u64, String> {
        let actual_hash = hex::encode(Sha256::digest(data));
        if actual_hash != expected_hash {
            return Err(format!(
                "Shard hash mismatch: got {}..., expected {}...",
                &actual_hash[..actual_hash.len().min(16)],
                &expected_hash[..expected_hash.len().min(16)]
            ));
        }

        let key = Self::key(file_id, shard_index);
        let incoming_size = data.len() as u64;

        // Compute net delta and check capacity while holding the lock briefly.
        {
            let guard = self.index.lock().unwrap();
            let existing = guard.sizes.get(&key).copied();
            let new_used = match existing {
                None => guard.used_bytes + incoming_size,
                Some(prev) => guard.used_bytes + incoming_size - prev,
            };
            if new_used > self.capacity_bytes {
                return Err(format!(
                    "capacity exceeded: {} > {}",
                    new_used, self.capacity_bytes
                ));
            }
        }

        let path = self.shard_path(file_id, shard_index);
        let prefix: String = file_id.chars().take(2).collect();
        std::fs::create_dir_all(self.shards_dir().join(prefix))
            .map_err(|e| format!("mkdir failed: {e}"))?;
        std::fs::write(&path, data).map_err(|e| format!("write failed: {e}"))?;

        // Update counters after a successful write.
        {
            let mut guard = self.index.lock().unwrap();
            let existing = guard.sizes.get(&key).copied();
            match existing {
                None => {
                    guard.shard_count += 1;
                    guard.used_bytes += incoming_size;
                }
                Some(prev) => {
                    guard.used_bytes = guard.used_bytes + incoming_size - prev;
                }
            }
            guard.sizes.insert(key, incoming_size);
        }
        self.persist_index();
        Ok(incoming_size)
    }

    /// Read a shard from disk. Returns `None` if it does not exist.
    pub fn retrieve(&self, file_id: &str, shard_index: u32) -> std::io::Result<Option<Vec<u8>>> {
        match std::fs::read(self.shard_path(file_id, shard_index)) {
            Ok(buf) => Ok(Some(buf)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Remove a shard. Returns true if a file was actually unlinked. Keeps the
    /// index consistent even when the file is already gone.
    pub fn remove(&self, file_id: &str, shard_index: u32) -> std::io::Result<bool> {
        let key = Self::key(file_id, shard_index);
        match std::fs::remove_file(self.shard_path(file_id, shard_index)) {
            Ok(()) => {
                {
                    let mut guard = self.index.lock().unwrap();
                    if let Some(removed) = guard.sizes.remove(&key) {
                        guard.used_bytes = guard.used_bytes.saturating_sub(removed);
                        guard.shard_count = guard.shard_count.saturating_sub(1);
                    }
                }
                self.persist_index();
                Ok(true)
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                // File already gone; reconcile the index if it still tracks it.
                let reconciled = {
                    let mut guard = self.index.lock().unwrap();
                    if let Some(removed) = guard.sizes.remove(&key) {
                        guard.used_bytes = guard.used_bytes.saturating_sub(removed);
                        guard.shard_count = guard.shard_count.saturating_sub(1);
                        true
                    } else {
                        false
                    }
                };
                if reconciled {
                    self.persist_index();
                }
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    /// O(1) read of the tracked used bytes.
    pub fn used_bytes(&self) -> u64 {
        self.index.lock().unwrap().used_bytes
    }

    /// O(1) read of the tracked shard count.
    pub fn shard_count(&self) -> u64 {
        self.index.lock().unwrap().shard_count
    }
}

/// Recursively walk `dir`, invoking `on_file(path, size)` for every regular
/// file. Missing directories are treated as empty.
fn walk_dir(dir: &Path, on_file: &mut dyn FnMut(&Path, u64)) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => walk_dir(&path, on_file),
            Ok(ft) if ft.is_file() => {
                if let Ok(meta) = entry.metadata() {
                    on_file(&path, meta.len());
                }
            }
            _ => {}
        }
    }
}
