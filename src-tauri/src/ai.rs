// The optional AI chat: the OpenRouter key store and the HTTPS call (src/chat/ in the interface).
// Nothing here runs unless the user has entered a key and sends a message: the app makes no network
// request otherwise. The key lives in one file in the app config folder (mode 0600 on Unix), is read
// here and never handed back to the webview (only a masked hint is), and is never logged.
// The chat call streams the server-sent events back over a Tauri channel, one `data:` payload per
// message, so the TypeScript side parses the same payloads as the browser build's fetch() does.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;
use tauri::ipc::Channel;

const API: &str = "https://openrouter.ai/api/v1";
const KEY_FILE: &str = "openrouter.key";
/// Longest accepted key (OpenRouter keys are ~75 characters); anything longer is a paste mistake.
const KEY_MAX: usize = 512;

/// What went wrong, for the interface to put in plain words (src/chat/client.ts plainError).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct AiError {
    /// "no-key" | "http" | "offline" | "cancelled" | "storage" | "bad-key"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    pub message: String,
}

impl AiError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        AiError { kind: kind.into(), status: None, message: message.into() }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct KeyStatus {
    pub stored: bool,
    /// The key masked to its prefix and last four characters, "sk-or-v1-…3f9a".
    pub hint: Option<String>,
}

// ---------------------------------------------------------------- key file
fn key_path(app: &tauri::AppHandle) -> Result<PathBuf, AiError> {
    let dir = app.path().app_config_dir().map_err(|e| AiError::new("storage", format!("could not find the app config folder: {e}")))?;
    Ok(dir.join(KEY_FILE))
}

/// A pasted key, trimmed; rejects empty, over-long and multi-line text (a key is one token).
pub fn clean_key(key: &str) -> Result<String, AiError> {
    let k = key.trim();
    if k.is_empty() || k.len() > KEY_MAX || k.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AiError::new("bad-key", "That does not look like an API key: paste the whole key, on one line."));
    }
    Ok(k.to_string())
}

pub fn hint(key: &str) -> String {
    let n = key.chars().count();
    let tail: String = key.chars().skip(n.saturating_sub(4)).collect();
    let head: String = if key.starts_with("sk-or-v1-") { "sk-or-v1-".into() } else { key.chars().take(3.min(n.saturating_sub(4))).collect() };
    format!("{head}…{tail}")
}

/// Writes the key readable by the owner only. The mode is set on creation and again afterwards, so an
/// older file with looser permissions is tightened too.
pub fn write_key(path: &Path, key: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(key.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn read_key(path: &Path) -> Option<String> {
    let k = fs::read_to_string(path).ok()?;
    let k = k.trim();
    (!k.is_empty()).then(|| k.to_string())
}

fn status_of(key: Option<&str>) -> KeyStatus {
    KeyStatus { stored: key.is_some(), hint: key.map(hint) }
}

// ---------------------------------------------------------------- HTTPS
fn client() -> Result<&'static reqwest::Client, AiError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    // rustls with the ring provider (no OpenSSL, no aws-lc build); fails harmlessly if already installed
    let _ = rustls::crypto::ring::default_provider().install_default();
    let c = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(120))
        .user_agent(concat!("CrossoverStudio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AiError::new("offline", format!("could not start the HTTPS client: {e}")))?;
    Ok(CLIENT.get_or_init(|| c))
}

/// A transport failure as the interface reports it. The text is reqwest's (it never holds the key).
fn net_err(e: reqwest::Error) -> AiError {
    let what = if e.is_timeout() { "the connection timed out" } else if e.is_connect() { "could not connect" } else { "the connection failed" };
    AiError::new("offline", format!("{what}: {e}"))
}

/// The human part of an OpenRouter error body ({"error":{"message":...}}), else the body itself, cut short.
pub fn error_message(body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let msg = parsed
        .as_ref()
        .and_then(|v| v.get("error"))
        .and_then(|e| e.get("message").and_then(Value::as_str).map(str::to_string).or_else(|| e.as_str().map(str::to_string)));
    let m = msg.unwrap_or_else(|| body.trim().to_string());
    m.chars().take(300).collect()
}

async fn http_error(resp: reqwest::Response) -> AiError {
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    AiError { kind: "http".into(), status: Some(status), message: error_message(&body) }
}

/// Splits complete lines off the front of `buf` and returns the `data:` payloads among them (SSE).
/// Comment lines (": OPENROUTER PROCESSING") and other fields are skipped; an unfinished last line
/// stays in the buffer, so a UTF-8 character split across two chunks is never cut.
pub fn take_events(buf: &mut Vec<u8>) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = buf.drain(..=pos).collect();
        let line = String::from_utf8_lossy(&line);
        let line = line.trim_end_matches(['\r', '\n']);
        if let Some(data) = line.strip_prefix("data:") {
            out.push(data.trim_start().to_string());
        }
    }
    out
}

/// Bumped by every new chat and by ai_cancel: a stream whose number is no longer current stops.
static GENERATION: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------- commands
#[tauri::command]
pub fn ai_key_status(app: tauri::AppHandle) -> Result<KeyStatus, AiError> {
    Ok(status_of(read_key(&key_path(&app)?).as_deref()))
}

/// Stores the key (or removes it when `key` is null or empty).
#[tauri::command]
pub fn ai_set_key(app: tauri::AppHandle, key: Option<String>) -> Result<KeyStatus, AiError> {
    let path = key_path(&app)?;
    match key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(|e| AiError::new("storage", format!("could not remove the key file: {e}")))?;
            }
            Ok(status_of(None))
        }
        Some(k) => {
            let k = clean_key(k)?;
            write_key(&path, &k).map_err(|e| AiError::new("storage", format!("could not save the key: {e}")))?;
            Ok(status_of(Some(&k)))
        }
    }
}

/// Checks a key with OpenRouter (GET /key: its label, credit limit and usage). Tests `key` when given,
/// else the stored one.
#[tauri::command]
pub async fn ai_test_key(app: tauri::AppHandle, key: Option<String>) -> Result<Value, AiError> {
    let key = match key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => clean_key(k)?,
        None => read_key(&key_path(&app)?).ok_or_else(|| AiError::new("no-key", "No API key saved yet."))?,
    };
    let resp = client()?.get(format!("{API}/key")).bearer_auth(&key).send().await.map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(http_error(resp).await);
    }
    let text = resp.text().await.map_err(net_err)?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// One chat completion request (`body` is the OpenAI-style JSON the interface built, with stream: true).
/// Every server-sent `data:` payload goes to `on_event`; the call returns when the stream ends.
#[tauri::command]
pub async fn ai_chat(app: tauri::AppHandle, body: String, on_event: Channel<String>) -> Result<(), AiError> {
    let key = read_key(&key_path(&app)?).ok_or_else(|| AiError::new("no-key", "No API key saved yet."))?;
    let me = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let mut resp = client()?
        .post(format!("{API}/chat/completions"))
        .bearer_auth(&key)
        .header("Content-Type", "application/json")
        // OpenRouter's optional app attribution headers
        .header("HTTP-Referer", "https://github.com/MadsRudolph/crossover-studio")
        .header("X-Title", "Crossover Studio")
        .body(body)
        .send()
        .await
        .map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(http_error(resp).await);
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
        if GENERATION.load(Ordering::SeqCst) != me {
            return Err(AiError::new("cancelled", "Stopped."));
        }
        buf.extend_from_slice(&chunk);
        for data in take_events(&mut buf) {
            if data == "[DONE]" {
                return Ok(());
            }
            on_event.send(data).map_err(|e| AiError::new("cancelled", format!("the window closed: {e}")))?;
        }
    }
    Ok(())
}

/// Stops the running chat stream, if any.
#[tauri::command]
pub fn ai_cancel() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_split_on_complete_lines_only() {
        let mut buf = b": OPENROUTER PROCESSING\n\ndata: {\"a\":1}\r\n\ndata: {\"b\":".to_vec();
        assert_eq!(take_events(&mut buf), vec!["{\"a\":1}".to_string()]);
        // the unfinished event waits for its line end; a multi-byte character split over chunks survives
        buf.extend_from_slice("\"µ".as_bytes()[..2].as_ref());
        assert!(take_events(&mut buf).is_empty());
        buf.extend_from_slice(&"\"µ\"}\n".as_bytes()[2..]);
        assert_eq!(take_events(&mut buf), vec!["{\"b\":\"µ\"}".to_string()]);
        buf.extend_from_slice(b"data: [DONE]\n");
        assert_eq!(take_events(&mut buf), vec!["[DONE]".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn error_bodies_give_their_message() {
        assert_eq!(error_message(r#"{"error":{"message":"No auth credentials found","code":401}}"#), "No auth credentials found");
        assert_eq!(error_message("Bad gateway"), "Bad gateway");
        assert_eq!(error_message(r#"{"error":"rate limited"}"#), "rate limited");
    }

    #[test]
    fn keys_are_cleaned_and_masked() {
        assert_eq!(clean_key("  sk-or-v1-abc123  \n").unwrap(), "sk-or-v1-abc123");
        assert!(clean_key("").is_err());
        assert!(clean_key("two words").is_err());
        assert_eq!(hint("sk-or-v1-0123456789abcdef"), "sk-or-v1-…cdef");
        assert_eq!(hint("abcdefgh"), "abc…efgh");
        assert_eq!(hint("ab"), "…ab");
    }

    #[test]
    fn the_key_file_is_private_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("cs-ai-test-{}", std::process::id()));
        let path = dir.join("sub").join(KEY_FILE);
        write_key(&path, "sk-or-v1-first").unwrap();
        write_key(&path, "sk-or-v1-second").unwrap();
        assert_eq!(read_key(&path).as_deref(), Some("sk-or-v1-second"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        fs::write(&path, "  \n").unwrap();
        assert_eq!(read_key(&path), None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A made-up key must come back as a plain HTTP 401, not as a transport error. Needs the network,
    /// so it only runs on request: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn a_fake_key_is_refused_with_401() {
        let rt = tauri::async_runtime::block_on(async {
            let resp = client().unwrap().get(format!("{API}/key")).bearer_auth("sk-or-v1-not-a-real-key").send().await.unwrap();
            http_error(resp).await
        });
        assert_eq!(rt.status, Some(401));
    }
}
