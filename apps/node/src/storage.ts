import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

interface ShardIndex {
  usedBytes: number;
  shardCount: number;
  sizes: Record<string, number>; // keyed by `${fileId}_${shardIndex}`
}

const INDEX_VERSION = 1;

export class ShardStorage {
  private readonly root: string;
  private readonly capacityBytes: number;

  private index: ShardIndex = { usedBytes: 0, shardCount: 0, sizes: {} };
  private indexLoaded = false;

  // Serialize index persistence so concurrent writes never corrupt the file.
  private persistChain: Promise<void> = Promise.resolve();
  private persistQueued = false;

  constructor(root: string, capacityBytes: number = Infinity) {
    this.root = root;
    this.capacityBytes = capacityBytes;
  }

  async init() {
    await fs.mkdir(this.shardsDir(), { recursive: true });
    await this.loadIndex();
  }

  private shardsDir() {
    return join(this.root, 'shards');
  }

  private indexPath() {
    return join(this.root, 'shard-index.json');
  }

  private shardPath(fileId: string, shardIndex: number) {
    const prefix = fileId.slice(0, 2);
    return join(this.shardsDir(), prefix, `${fileId}_${shardIndex}.bin`);
  }

  private key(fileId: string, shardIndex: number) {
    return `${fileId}_${shardIndex}`;
  }

  /**
   * Load the persisted index and trust it. If it is missing or corrupt, fall
   * back to a full rebuild by walking the shards directory.
   */
  private async loadIndex() {
    if (this.indexLoaded) return;
    try {
      const raw = await fs.readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.usedBytes === 'number' &&
        typeof parsed.shardCount === 'number' &&
        parsed.sizes &&
        typeof parsed.sizes === 'object'
      ) {
        this.index = {
          usedBytes: parsed.usedBytes,
          shardCount: parsed.shardCount,
          sizes: parsed.sizes,
        };
        this.indexLoaded = true;
        return;
      }
      await this.rebuildIndex();
    } catch {
      await this.rebuildIndex();
    }
    this.indexLoaded = true;
  }

  /** Walk the shards directory once and rebuild the in-memory index. */
  private async rebuildIndex() {
    const index: ShardIndex = { usedBytes: 0, shardCount: 0, sizes: {} };
    await walkDir(this.shardsDir(), async (path) => {
      const stat = await fs.stat(path);
      const name = path.slice(path.lastIndexOf('/') + 1);
      const key = name.endsWith('.bin') ? name.slice(0, -4) : name;
      index.sizes[key] = stat.size;
      index.usedBytes += stat.size;
      index.shardCount++;
    });
    this.index = index;
    this.indexLoaded = true;
    await this.persistIndex();
  }

  /**
   * Persist the index atomically (write to a temp file then rename). Writes are
   * serialized so concurrent mutations cannot interleave and corrupt the file.
   * Multiple queued requests collapse into a single trailing write.
   */
  private persistIndex(): Promise<void> {
    if (this.persistQueued) return this.persistChain;
    this.persistQueued = true;
    this.persistChain = this.persistChain
      .catch(() => {})
      .then(async () => {
        this.persistQueued = false;
        const tmp = `${this.indexPath()}.tmp`;
        const payload = JSON.stringify({
          version: INDEX_VERSION,
          usedBytes: this.index.usedBytes,
          shardCount: this.index.shardCount,
          sizes: this.index.sizes,
        });
        await fs.writeFile(tmp, payload);
        await fs.rename(tmp, this.indexPath());
      });
    return this.persistChain;
  }

  async store(
    fileId: string,
    shardIndex: number,
    data: Uint8Array,
    expectedHash: string,
  ) {
    const actualHash = createHash('sha256').update(data).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `Shard hash mismatch: got ${actualHash.slice(0, 16)}..., expected ${expectedHash.slice(0, 16)}...`,
      );
    }

    const key = this.key(fileId, shardIndex);
    const incomingSize = data.length;
    const existingSize = this.index.sizes[key];
    // Only the net delta counts toward capacity when overwriting.
    const delta =
      existingSize === undefined ? incomingSize : incomingSize - existingSize;

    if (this.index.usedBytes + delta > this.capacityBytes) {
      throw new Error(
        `capacity exceeded: ${this.index.usedBytes + delta} > ${this.capacityBytes}`,
      );
    }

    const path = this.shardPath(fileId, shardIndex);
    await fs.mkdir(join(this.shardsDir(), fileId.slice(0, 2)), {
      recursive: true,
    });
    await fs.writeFile(path, data);

    if (existingSize === undefined) {
      this.index.shardCount++;
    }
    this.index.usedBytes += delta;
    this.index.sizes[key] = incomingSize;
    await this.persistIndex();
  }

  async retrieve(
    fileId: string,
    shardIndex: number,
  ): Promise<Uint8Array | null> {
    try {
      const buf = await fs.readFile(this.shardPath(fileId, shardIndex));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async remove(fileId: string, shardIndex: number): Promise<boolean> {
    const key = this.key(fileId, shardIndex);
    try {
      await fs.unlink(this.shardPath(fileId, shardIndex));
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        // File already gone; reconcile the index if it still tracks it.
        if (this.index.sizes[key] !== undefined) {
          this.index.usedBytes -= this.index.sizes[key];
          this.index.shardCount = Math.max(0, this.index.shardCount - 1);
          delete this.index.sizes[key];
          await this.persistIndex();
        }
        return false;
      }
      throw e;
    }

    const removedSize = this.index.sizes[key];
    if (removedSize !== undefined) {
      this.index.usedBytes = Math.max(0, this.index.usedBytes - removedSize);
      this.index.shardCount = Math.max(0, this.index.shardCount - 1);
      delete this.index.sizes[key];
    }
    await this.persistIndex();
    return true;
  }

  async usedBytes(): Promise<number> {
    return this.index.usedBytes;
  }

  async shardCount(): Promise<number> {
    return this.index.shardCount;
  }

  /** Synchronous O(1) accessors backed by the in-memory index. */
  usedBytesSync(): number {
    return this.index.usedBytes;
  }

  shardCountSync(): number {
    return this.index.shardCount;
  }
}

async function walkDir(dir: string, onFile: (path: string) => Promise<void>) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e: any) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}
