// Native Rust reimplementation of the TypeScript node's WS client
// (apps/node/src/ws-client.ts). Connects to the coordinator, receives shard
// commands, stores/serves shards through `ShardStorage`, and replies on the
// same socket. Reconnects with exponential backoff (1s -> 30s) until stopped.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::storage::ShardStorage;

/// Inbound command frame from the coordinator.
#[derive(Deserialize)]
struct Command {
    id: String,
    cmd: String,
    #[serde(rename = "fileId")]
    file_id: Option<String>,
    #[serde(rename = "shardIndex")]
    shard_index: Option<u32>,
    hash: Option<String>,
    data: Option<String>, // base64
}

/// Outbound reply frame. Skips absent optional fields.
#[derive(Serialize)]
struct Reply {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>, // base64
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

/// Everything the WS task needs to run.
pub struct WsConfig {
    pub coordinator: String,
    pub node_id: String,
    pub node_token: String,
    pub version: String,
    pub capacity_bytes: u64,
    pub storage: Arc<ShardStorage>,
    pub app_state: Arc<crate::AppState>,
}

/// Convert the coordinator base URL into the `/nodes/<id>/connect` ws(s) URL.
fn ws_url(coordinator: &str, node_id: &str) -> String {
    let lowered = coordinator.trim_end_matches('/');
    let with_scheme = if let Some(rest) = lowered.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = lowered.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if lowered.starts_with("wss://") || lowered.starts_with("ws://") {
        lowered.to_string()
    } else {
        // Default to ws:// for a bare host.
        format!("ws://{lowered}")
    };
    format!("{with_scheme}/nodes/{node_id}/connect")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Run the WS client loop until a stop signal is received on `stop_rx`.
/// Reconnects with exponential backoff between attempts.
pub async fn run(cfg: WsConfig, mut stop_rx: mpsc::Receiver<()>) {
    let mut delay = 1u64;
    const MAX_DELAY: u64 = 30;

    loop {
        // Check for a stop signal before attempting to connect.
        if stop_rx.try_recv().is_ok() {
            return;
        }

        match connect_once(&cfg, &mut stop_rx).await {
            ConnectOutcome::Stopped => return,
            ConnectOutcome::Opened => {
                // Successful session ended (remote close); reset backoff.
                delay = 1;
            }
            ConnectOutcome::Failed => {}
        }

        // Backoff before reconnecting, but wake immediately on stop.
        tokio::select! {
            _ = stop_rx.recv() => return,
            _ = tokio::time::sleep(std::time::Duration::from_secs(delay)) => {
                delay = (delay * 2).min(MAX_DELAY);
            }
        }
    }
}

enum ConnectOutcome {
    /// Stop signal received.
    Stopped,
    /// Connection opened and later closed normally.
    Opened,
    /// Connection attempt failed before opening.
    Failed,
}

async fn connect_once(cfg: &WsConfig, stop_rx: &mut mpsc::Receiver<()>) -> ConnectOutcome {
    let url = ws_url(&cfg.coordinator, &cfg.node_id);

    let request = match build_request(&url, cfg) {
        Ok(req) => req,
        Err(_) => return ConnectOutcome::Failed,
    };

    let (ws_stream, _resp) = match connect_async(request).await {
        Ok(pair) => pair,
        Err(_) => return ConnectOutcome::Failed,
    };

    let (mut writer, mut reader) = ws_stream.split();

    loop {
        tokio::select! {
            _ = stop_rx.recv() => {
                let _ = writer.close().await;
                return ConnectOutcome::Stopped;
            }
            frame = reader.next() => {
                match frame {
                    Some(Ok(WsMessage::Text(text))) => {
                        if let Some(reply) = handle_text(cfg, &text).await {
                            if writer.send(WsMessage::Text(reply)).await.is_err() {
                                return ConnectOutcome::Opened;
                            }
                        }
                    }
                    Some(Ok(WsMessage::Ping(payload))) => {
                        let _ = writer.send(WsMessage::Pong(payload)).await;
                    }
                    Some(Ok(WsMessage::Close(_))) | None => {
                        return ConnectOutcome::Opened;
                    }
                    Some(Ok(_)) => { /* ignore binary/pong */ }
                    Some(Err(_)) => return ConnectOutcome::Opened,
                }
            }
        }
    }
}

fn build_request(
    url: &str,
    cfg: &WsConfig,
) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("bad ws url: {e}"))?;
    let headers = request.headers_mut();
    let token = HeaderValue::from_str(&cfg.node_token).map_err(|e| e.to_string())?;
    let bearer =
        HeaderValue::from_str(&format!("Bearer {}", cfg.node_token)).map_err(|e| e.to_string())?;
    let version = HeaderValue::from_str(&cfg.version).map_err(|e| e.to_string())?;
    let capacity =
        HeaderValue::from_str(&cfg.capacity_bytes.to_string()).map_err(|e| e.to_string())?;
    headers.insert("x-node-token", token);
    headers.insert("Authorization", bearer);
    headers.insert("x-node-version", version);
    headers.insert("x-node-capacity", capacity);
    Ok(request)
}

/// Parse and handle one inbound text frame, returning the serialized reply (or
/// `None` if the frame was unparseable / had no reply).
async fn handle_text(cfg: &WsConfig, text: &str) -> Option<String> {
    let msg: Command = serde_json::from_str(text).ok()?;
    let reply = handle_command(cfg, msg).await;
    serde_json::to_string(&reply).ok()
}

async fn handle_command(cfg: &WsConfig, msg: Command) -> Reply {
    match msg.cmd.as_str() {
        "ping" => Reply {
            id: msg.id,
            ok: true,
            error: None,
            data: None,
            size: None,
        },
        "store" => handle_store(cfg, msg).await,
        "retrieve" => handle_retrieve(cfg, msg).await,
        "delete" => handle_delete(cfg, msg).await,
        _ => Reply {
            id: msg.id,
            ok: false,
            error: Some("unknown command".to_string()),
            data: None,
            size: None,
        },
    }
}

fn err_reply(id: String, error: &str) -> Reply {
    Reply {
        id,
        ok: false,
        error: Some(error.to_string()),
        data: None,
        size: None,
    }
}

async fn handle_store(cfg: &WsConfig, msg: Command) -> Reply {
    let (file_id, shard_index, hash, data_b64) =
        match (msg.file_id, msg.shard_index, msg.hash, msg.data) {
            (Some(f), Some(i), Some(h), Some(d)) => (f, i, h, d),
            _ => return err_reply(msg.id, "missing fields"),
        };

    let data = match base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => return err_reply(msg.id, &format!("invalid base64: {e}")),
    };

    let storage = cfg.storage.clone();
    let file_id_c = file_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        storage.store(&file_id_c, shard_index, &data, &hash).map(|_| data.len() as u64)
    })
    .await;

    match result {
        Ok(Ok(size)) => {
            record_activity(cfg, "uploaded", &file_id, shard_index, size);
            Reply {
                id: msg.id,
                ok: true,
                error: None,
                data: None,
                size: Some(size),
            }
        }
        Ok(Err(e)) => err_reply(msg.id, &e),
        Err(e) => err_reply(msg.id, &format!("store task failed: {e}")),
    }
}

async fn handle_retrieve(cfg: &WsConfig, msg: Command) -> Reply {
    let (file_id, shard_index) = match (msg.file_id, msg.shard_index) {
        (Some(f), Some(i)) => (f, i),
        _ => return err_reply(msg.id, "missing fields"),
    };

    let storage = cfg.storage.clone();
    let file_id_c = file_id.clone();
    let result =
        tokio::task::spawn_blocking(move || storage.retrieve(&file_id_c, shard_index)).await;

    match result {
        Ok(Ok(Some(bytes))) => {
            let size = bytes.len() as u64;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            record_activity(cfg, "downloaded", &file_id, shard_index, size);
            Reply {
                id: msg.id,
                ok: true,
                error: None,
                data: Some(encoded),
                size: Some(size),
            }
        }
        Ok(Ok(None)) => err_reply(msg.id, "not found"),
        Ok(Err(e)) => err_reply(msg.id, &format!("read failed: {e}")),
        Err(e) => err_reply(msg.id, &format!("retrieve task failed: {e}")),
    }
}

async fn handle_delete(cfg: &WsConfig, msg: Command) -> Reply {
    let (file_id, shard_index) = match (msg.file_id, msg.shard_index) {
        (Some(f), Some(i)) => (f, i),
        _ => return err_reply(msg.id, "missing fields"),
    };

    let storage = cfg.storage.clone();
    let file_id_c = file_id.clone();
    let result =
        tokio::task::spawn_blocking(move || storage.remove(&file_id_c, shard_index)).await;

    match result {
        Ok(Ok(removed)) => {
            if removed {
                record_activity(cfg, "deleted", &file_id, shard_index, 0);
            }
            Reply {
                id: msg.id,
                ok: true,
                error: None,
                data: None,
                size: None,
            }
        }
        Ok(Err(e)) => err_reply(msg.id, &format!("delete failed: {e}")),
        Err(e) => err_reply(msg.id, &format!("delete task failed: {e}")),
    }
}

/// Push an activity event into the shared buffer and refresh the live
/// used/shard counters from the storage index. Newest first, capped at 50.
fn record_activity(cfg: &WsConfig, kind: &str, file_id: &str, shard_index: u32, size: u64) {
    {
        let mut activity = cfg.app_state.activity.lock().unwrap();
        activity.insert(
            0,
            crate::ActivityEvent {
                kind: kind.to_string(),
                file_id: file_id.to_string(),
                shard_index,
                size,
                timestamp: now_secs(),
            },
        );
        activity.truncate(50);
    }
    let used = cfg.storage.used_bytes();
    let count = cfg.storage.shard_count();
    let mut node = cfg.app_state.node_state.lock().unwrap();
    node.used_bytes = used;
    node.shard_count = count;
}
