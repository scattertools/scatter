// Scatter Node GUI — Tauri backend.
//
// This is a full shard-serving node: it registers the machine with the
// coordinator, sends authenticated heartbeats while running, persists local
// config, and — over the coordinator WebSocket protocol — stores, serves, and
// deletes shards on local disk (functionally equivalent to the apps/node
// TypeScript daemon, reimplemented natively in Rust). It tracks live state for
// the UI to poll. See DESIGN.md for the architecture.

mod storage;
mod ws_client;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::mpsc;

use storage::ShardStorage;

const VERSION: &str = "0.1.0";
const DEFAULT_CAPACITY_BYTES: u64 = 50 * 1024 * 1024 * 1024; // 50 GB
const DEFAULT_COORDINATOR: &str = "http://localhost:4000";
const HEARTBEAT_INTERVAL_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// State shared with the frontend (serialized to camelCase for JS consumption).
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeState {
    connected: bool,
    node_id: Option<String>,
    used_bytes: u64,
    capacity_bytes: u64,
    shard_count: u64,
    credits_earned: u64,
    uptime_seconds: u64,
}

impl Default for NodeState {
    fn default() -> Self {
        Self {
            connected: false,
            node_id: None,
            used_bytes: 0,
            capacity_bytes: DEFAULT_CAPACITY_BYTES,
            shard_count: 0,
            credits_earned: 0,
            uptime_seconds: 0,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityEvent {
    pub(crate) kind: String, // "uploaded" | "downloaded" | "deleted"
    pub(crate) file_id: String,
    pub(crate) shard_index: u32,
    pub(crate) size: u64,
    pub(crate) timestamp: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    email: String,
    username: String,
    balance: i64,
}

pub(crate) struct AppState {
    pub(crate) node_state: Mutex<NodeState>,
    pub(crate) activity: Mutex<Vec<ActivityEvent>>,
    started_at: Mutex<Option<Instant>>,
    shutdown_tx: Mutex<Option<mpsc::Sender<()>>>,
    ws_shutdown_tx: Mutex<Option<mpsc::Sender<()>>>,
    account: Mutex<Option<Account>>,
    /// Secret device code for an in-progress OAuth-style login, kept server-side
    /// so the frontend only ever sees the short user code.
    pending_device_code: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            node_state: Mutex::new(NodeState::default()),
            activity: Mutex::new(Vec::new()),
            started_at: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            ws_shutdown_tx: Mutex::new(None),
            account: Mutex::new(None),
            pending_device_code: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// On-disk config (~/.scatter/gui-config.json)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct Config {
    node_id: Option<String>,
    #[serde(default)]
    node_token: Option<String>,
    capacity_bytes: u64,
    coordinator: String,
    #[serde(default)]
    session: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            node_id: None,
            node_token: None,
            capacity_bytes: DEFAULT_CAPACITY_BYTES,
            coordinator: DEFAULT_COORDINATOR.to_string(),
            session: None,
        }
    }
}

fn config_path() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".scatter");
    let _ = fs::create_dir_all(&path);
    path.push("gui-config.json");
    path
}

/// Root directory for shard storage (same `~/.scatter` dir as the config).
fn data_root() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".scatter");
    let _ = fs::create_dir_all(&path);
    path
}

/// Initialize the shard storage, loading or rebuilding its index, and refresh
/// the live node state counters from it. Returns the storage handle.
fn init_storage(state: &Arc<AppState>, capacity_bytes: u64) -> Arc<ShardStorage> {
    let storage = Arc::new(ShardStorage::new(data_root(), capacity_bytes));
    let _ = storage.init();
    {
        let mut s = state.node_state.lock().unwrap();
        s.used_bytes = storage.used_bytes();
        s.shard_count = storage.shard_count();
    }
    storage
}

fn load_config() -> Config {
    let path = config_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(config: &Config) {
    let path = config_path();
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, json);
    }
}

// ---------------------------------------------------------------------------
// Coordinator response shapes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RegisterResponse {
    #[serde(rename = "nodeId")]
    node_id: String,
    #[serde(rename = "nodeToken")]
    node_token: String,
}

#[derive(Deserialize)]
struct VerifyResponse {
    session: String,
    user: VerifyUser,
}

#[derive(Deserialize)]
struct VerifyUser {
    email: String,
    #[serde(default)]
    username: String,
}

#[derive(Deserialize)]
struct CreditsResponse {
    balance: i64,
}

/// Response from `POST /auth/device/start`.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeviceStartResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    verification_url_complete: String,
    #[serde(default)]
    expires_in_minutes: u64,
    #[serde(default)]
    poll_interval_seconds: u64,
}

/// What the frontend needs to drive the device flow. Mirrors the coordinator
/// response but hides the secret `device_code`, which stays in the backend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeviceLogin {
    user_code: String,
    verification_url: String,
    verification_url_complete: String,
    expires_in_minutes: u64,
    poll_interval_seconds: u64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_state(state: State<Arc<AppState>>) -> NodeState {
    let mut s = state.node_state.lock().unwrap().clone();
    if let Some(started) = *state.started_at.lock().unwrap() {
        s.uptime_seconds = started.elapsed().as_secs();
    }
    if let Some(acct) = state.account.lock().unwrap().as_ref() {
        s.credits_earned = acct.balance.max(0) as u64;
    }
    s
}

#[tauri::command]
fn get_activity(state: State<Arc<AppState>>) -> Vec<ActivityEvent> {
    state.activity.lock().unwrap().clone()
}

#[tauri::command]
fn get_account(state: State<Arc<AppState>>) -> Option<Account> {
    state.account.lock().unwrap().clone()
}

#[tauri::command]
async fn start_node(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut config = load_config();

    // Register on first run (or if we never captured a node token).
    if config.node_id.is_none() || config.node_token.is_none() {
        let client = reqwest::Client::new();
        let mut req = client
            .post(format!("{}/nodes/register", config.coordinator))
            .json(&serde_json::json!({
                "capacityBytes": config.capacity_bytes,
                "version": VERSION,
            }));
        // Bind the node to the signed-in user when a session is saved.
        if let Some(session) = config.session.clone() {
            req = req.bearer_auth(session);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("could not reach coordinator: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("registration failed: {}", resp.status()));
        }

        let parsed = resp
            .json::<RegisterResponse>()
            .await
            .map_err(|e| format!("bad registration response: {e}"))?;

        config.node_id = Some(parsed.node_id.clone());
        config.node_token = Some(parsed.node_token.clone());
        save_config(&config);
    }

    let node_id = config
        .node_id
        .clone()
        .ok_or_else(|| "missing node id".to_string())?;
    let node_token = config
        .node_token
        .clone()
        .ok_or_else(|| "missing node token".to_string())?;

    // Bring up shard storage and seed live counters from its index.
    let storage = init_storage(state.inner(), config.capacity_bytes);

    {
        let mut s = state.node_state.lock().unwrap();
        s.connected = true;
        s.node_id = config.node_id.clone();
        s.capacity_bytes = config.capacity_bytes;
    }

    *state.started_at.lock().unwrap() = Some(Instant::now());

    let (tx, mut rx) = mpsc::channel::<()>(1);
    *state.shutdown_tx.lock().unwrap() = Some(tx);

    let state_clone = state.inner().clone();
    let coordinator = config.coordinator.clone();
    let heartbeat_node_id = node_id.clone();
    let heartbeat_token = node_token.clone();

    // Heartbeat loop — keeps the node marked "online" with the coordinator,
    // now authenticated with the node token and reporting real usage.
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        loop {
            tokio::select! {
                _ = rx.recv() => break,
                _ = tokio::time::sleep(Duration::from_secs(HEARTBEAT_INTERVAL_SECS)) => {
                    let s = state_clone.node_state.lock().unwrap().clone();
                    let _ = client
                        .post(format!("{coordinator}/nodes/{heartbeat_node_id}/heartbeat"))
                        .bearer_auth(&heartbeat_token)
                        .json(&serde_json::json!({
                            "usedBytes": s.used_bytes,
                            "capacityBytes": s.capacity_bytes,
                        }))
                        .send()
                        .await;
                }
            }
        }
    });

    // WebSocket client loop — stores/serves shards and replies to commands.
    let (ws_tx, ws_rx) = mpsc::channel::<()>(1);
    *state.ws_shutdown_tx.lock().unwrap() = Some(ws_tx);

    let ws_cfg = ws_client::WsConfig {
        coordinator: config.coordinator.clone(),
        node_id,
        node_token,
        version: VERSION.to_string(),
        capacity_bytes: config.capacity_bytes,
        storage,
        app_state: state.inner().clone(),
    };
    tokio::spawn(async move {
        ws_client::run(ws_cfg, ws_rx).await;
    });

    Ok(())
}

#[tauri::command]
async fn stop_node(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let tx = state.shutdown_tx.lock().unwrap().take();
    if let Some(tx) = tx {
        let _ = tx.send(()).await;
    }

    let ws_tx = state.ws_shutdown_tx.lock().unwrap().take();
    if let Some(ws_tx) = ws_tx {
        let _ = ws_tx.send(()).await;
    }

    {
        let mut s = state.node_state.lock().unwrap();
        s.connected = false;
    }
    *state.started_at.lock().unwrap() = None;

    Ok(())
}

#[tauri::command]
fn set_capacity(state: State<Arc<AppState>>, bytes: u64) -> Result<(), String> {
    let mut config = load_config();
    config.capacity_bytes = bytes;
    save_config(&config);

    state.node_state.lock().unwrap().capacity_bytes = bytes;
    Ok(())
}

/// Point the node at a different coordinator. Validates the URL is a non-empty
/// http(s) URL, persists it, and updates the cached config.
#[tauri::command]
fn set_coordinator(state: State<Arc<AppState>>, url: String) -> Result<(), String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("coordinator url cannot be empty".to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("coordinator url must start with http:// or https://".to_string());
    }
    // Reject a scheme with no host.
    let host = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    if host.is_empty() {
        return Err("coordinator url must include a host".to_string());
    }

    let mut config = load_config();
    config.coordinator = trimmed.to_string();
    save_config(&config);
    // Keep the command honest about touching state even though the URL isn't
    // mirrored into NodeState; the active loops pick it up on next start.
    let _ = &state;
    Ok(())
}

/// Return the currently configured coordinator URL.
#[tauri::command]
fn get_coordinator() -> String {
    load_config().coordinator
}

/// Step 1 of the OAuth-style device login: ask the coordinator for a device
/// code + short user code, stash the secret device code, and hand the frontend
/// everything it needs to open the verification page and start polling.
#[tauri::command]
async fn start_device_login(state: State<'_, Arc<AppState>>) -> Result<DeviceLogin, String> {
    let config = load_config();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/auth/device/start", config.coordinator))
        .send()
        .await
        .map_err(|e| format!("could not reach coordinator: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("could not start sign-in: {}", resp.status()));
    }

    let started = resp
        .json::<DeviceStartResponse>()
        .await
        .map_err(|e| format!("bad response: {e}"))?;

    *state.pending_device_code.lock().unwrap() = Some(started.device_code.clone());

    Ok(DeviceLogin {
        user_code: started.user_code,
        verification_url: started.verification_url,
        verification_url_complete: started.verification_url_complete,
        expires_in_minutes: started.expires_in_minutes,
        poll_interval_seconds: started.poll_interval_seconds.max(1),
    })
}

/// Step 2 of the device login: poll the coordinator with the stashed device
/// code. Returns `Some(account)` once the user approves in the browser, `None`
/// while still pending, or an error when the code is invalid/expired.
#[tauri::command]
async fn poll_device_login(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<Account>, String> {
    let device_code = state
        .pending_device_code
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no sign-in in progress".to_string())?;

    let mut config = load_config();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/auth/device/poll", config.coordinator))
        .json(&serde_json::json!({ "deviceCode": device_code }))
        .send()
        .await
        .map_err(|e| format!("could not reach coordinator: {e}"))?;

    let status = resp.status();
    if status == reqwest::StatusCode::GONE || status == reqwest::StatusCode::NOT_FOUND {
        *state.pending_device_code.lock().unwrap() = None;
        return Err("sign-in code expired, please try again".to_string());
    }
    if !status.is_success() {
        return Err(format!("sign-in failed: {status}"));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PollResponse {
        status: String,
        #[serde(default)]
        session: Option<String>,
        #[serde(default)]
        user: Option<VerifyUser>,
    }
    let parsed = resp
        .json::<PollResponse>()
        .await
        .map_err(|e| format!("bad response: {e}"))?;

    if parsed.status != "approved" {
        return Ok(None);
    }

    let session = parsed
        .session
        .ok_or_else(|| "missing session in response".to_string())?;
    let user = parsed.user.unwrap_or(VerifyUser {
        email: String::new(),
        username: String::new(),
    });

    config.session = Some(session.clone());
    save_config(&config);
    *state.pending_device_code.lock().unwrap() = None;

    let balance = fetch_balance(&client, &config.coordinator, &session)
        .await
        .unwrap_or(0);

    let account = Account {
        email: user.email,
        username: user.username,
        balance,
    };
    *state.account.lock().unwrap() = Some(account.clone());
    Ok(Some(account))
}

/// Alternative to the email flow: exchange a one-time login code (generated
/// in the web account settings while signed in there) for a session, persist
/// it, and load the account's credit balance.
#[tauri::command]
async fn login_with_code(
    state: State<'_, Arc<AppState>>,
    code: String,
) -> Result<Account, String> {
    let mut config = load_config();
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{}/auth/code/verify", config.coordinator))
        .json(&serde_json::json!({ "code": code.trim() }))
        .send()
        .await
        .map_err(|e| format!("could not reach coordinator: {e}"))?;

    if !resp.status().is_success() {
        return Err("invalid or expired code".to_string());
    }

    let verified = resp
        .json::<VerifyResponse>()
        .await
        .map_err(|e| format!("bad response: {e}"))?;

    config.session = Some(verified.session.clone());
    save_config(&config);

    let balance = fetch_balance(&client, &config.coordinator, &verified.session)
        .await
        .unwrap_or(0);

    let account = Account {
        email: verified.user.email,
        username: verified.user.username,
        balance,
    };
    *state.account.lock().unwrap() = Some(account.clone());
    Ok(account)
}

/// Change the signed-in user's username via the coordinator, updating the
/// cached account on success.
#[tauri::command]
async fn update_username(
    state: State<'_, Arc<AppState>>,
    username: String,
) -> Result<Account, String> {
    let config = load_config();
    let session = config
        .session
        .clone()
        .ok_or_else(|| "not signed in".to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{}/auth/me", config.coordinator))
        .bearer_auth(&session)
        .json(&serde_json::json!({ "username": username.trim() }))
        .send()
        .await
        .map_err(|e| format!("could not reach coordinator: {e}"))?;

    if !resp.status().is_success() {
        // Surface the coordinator's error message when present.
        let msg = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
            .unwrap_or_else(|| "could not update username".to_string());
        return Err(msg);
    }

    #[derive(Deserialize)]
    struct MeResponse {
        user: VerifyUser,
    }
    let parsed = resp
        .json::<MeResponse>()
        .await
        .map_err(|e| format!("bad response: {e}"))?;

    let mut guard = state.account.lock().unwrap();
    let balance = guard.as_ref().map(|a| a.balance).unwrap_or(0);
    let account = Account {
        email: parsed.user.email,
        username: parsed.user.username,
        balance,
    };
    *guard = Some(account.clone());
    Ok(account)
}

#[tauri::command]
fn logout(state: State<Arc<AppState>>) -> Result<(), String> {
    let mut config = load_config();
    config.session = None;
    save_config(&config);
    *state.account.lock().unwrap() = None;
    Ok(())
}

async fn fetch_balance(
    client: &reqwest::Client,
    coordinator: &str,
    session: &str,
) -> Option<i64> {
    let resp = client
        .get(format!("{coordinator}/credits"))
        .bearer_auth(session)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<CreditsResponse>().await.ok().map(|c| c.balance)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::default());

    // Hydrate from persisted config on launch.
    let config = load_config();
    {
        let mut s = state.node_state.lock().unwrap();
        s.capacity_bytes = config.capacity_bytes;
        s.node_id = config.node_id.clone();
    }

    // Seed the live used/shard counters from the persisted shard index so the
    // UI reflects real on-disk usage even before the node is started.
    init_storage(&state, config.capacity_bytes);

    // If we have a saved session, restore the account + balance in the background.
    if let Some(session) = config.session.clone() {
        let coordinator = config.coordinator.clone();
        let state_for_session = state.clone();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .ok()
            .map(|rt| {
                rt.block_on(async {
                    let client = reqwest::Client::new();
                    if let Ok(resp) = client
                        .get(format!("{coordinator}/auth/me"))
                        .bearer_auth(&session)
                        .send()
                        .await
                    {
                        if resp.status().is_success() {
                            #[derive(Deserialize)]
                            struct Me {
                                user: VerifyUser,
                            }
                            if let Ok(me) = resp.json::<Me>().await {
                                let balance =
                                    fetch_balance(&client, &coordinator, &session)
                                        .await
                                        .unwrap_or(0);
                                *state_for_session.account.lock().unwrap() = Some(Account {
                                    email: me.user.email,
                                    username: me.user.username,
                                    balance,
                                });
                            }
                        }
                    }
                });
            });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_activity,
            get_account,
            start_node,
            stop_node,
            set_capacity,
            set_coordinator,
            get_coordinator,
            start_device_login,
            poll_device_login,
            login_with_code,
            update_username,
            logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
