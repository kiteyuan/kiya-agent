use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Clone)]
pub struct PendingAuth {
    pub state: String,
    pub code_verifier: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub token_endpoint: String,
    pub userinfo_endpoint: String,
}

#[derive(Clone)]
pub enum CallbackPayload {
    Code { code: String, state: String },
    Error { message: String },
}

pub struct AuthManager {
    pending: Mutex<Option<PendingAuth>>,
    callback: Mutex<Option<CallbackPayload>>,
    logs: Mutex<Vec<String>>,
    callback_ready: AtomicBool,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self {
            pending: Mutex::new(None),
            callback: Mutex::new(None),
            logs: Mutex::new(vec![
                "[bootstrap] waiting for managed services".into(),
                "[bootstrap] waiting for auth callback service".into(),
            ]),
            callback_ready: AtomicBool::new(false),
        }
    }
}

impl AuthManager {
    pub fn push_log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(message.into());
        }
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.clone())
            .unwrap_or_else(|_| vec!["[bootstrap] failed to read logs".into()])
    }

    pub fn is_callback_ready(&self) -> bool {
        self.callback_ready.load(Ordering::SeqCst)
    }

    pub fn set_pending(&self, pending: PendingAuth) {
        if let Ok(mut slot) = self.pending.lock() {
            *slot = Some(pending);
        }
        if let Ok(mut callback) = self.callback.lock() {
            *callback = None;
        }
    }

    pub fn pending(&self) -> Option<PendingAuth> {
        self.pending.lock().ok().and_then(|slot| slot.clone())
    }

    pub fn callback(&self) -> Option<CallbackPayload> {
        self.callback.lock().ok().and_then(|slot| slot.clone())
    }

    pub fn set_callback(&self, payload: CallbackPayload) {
        if let Ok(mut callback) = self.callback.lock() {
            *callback = Some(payload);
        }
    }

    pub fn clear_auth_flow(&self) {
        if let Ok(mut slot) = self.pending.lock() {
            *slot = None;
        }
        if let Ok(mut callback) = self.callback.lock() {
            *callback = None;
        }
    }
}

pub type SharedAuthManager = Arc<AuthManager>;

pub fn generate_pkce_pair() -> (String, String) {
    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(96)
        .map(char::from)
        .collect();

    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

pub fn generate_state_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

pub fn spawn_callback_server(state: SharedAuthManager) {
    thread::spawn(move || match TcpListener::bind("127.0.0.1:14321") {
        Ok(listener) => {
            state.callback_ready.store(true, Ordering::SeqCst);
            state.push_log("[bootstrap] auth callback ready");

            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => handle_connection(stream, state.clone()),
                    Err(error) => state.push_log(format!(
                        "[auth] callback accept error: {error}"
                    )),
                }
            }
        }
        Err(error) => {
            state.callback_ready.store(false, Ordering::SeqCst);
            state.push_log(format!(
                "[auth] failed to bind callback server on 127.0.0.1:14321: {error}"
            ));
        }
    });
}

fn handle_connection(mut stream: TcpStream, state: SharedAuthManager) {
    let mut buffer = [0_u8; 4096];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(size) => size,
        Err(error) => {
            state.push_log(format!("[auth] callback read error: {error}"));
            return;
        }
    };

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    match request_path {
        "/health" => {
            let _ = write_response(
                &mut stream,
                "200 OK",
                "text/plain; charset=utf-8",
                "ok",
            );
        }
        _ if request_path.starts_with("/callback") => {
            let url = Url::parse(&format!("http://127.0.0.1:14321{request_path}"));
            match url {
                Ok(url) => {
                    let code = url
                        .query_pairs()
                        .find(|(key, _)| key == "code")
                        .map(|(_, value)| value.into_owned());
                    let state_token = url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .map(|(_, value)| value.into_owned());
                    let error = url
                        .query_pairs()
                        .find(|(key, _)| key == "error")
                        .map(|(_, value)| value.into_owned());
                    let error_description = url
                        .query_pairs()
                        .find(|(key, _)| key == "error_description")
                        .map(|(_, value)| value.into_owned());

                    if let Some(error) = error {
                        let message = error_description.unwrap_or(error);
                        state.set_callback(CallbackPayload::Error {
                            message: message.clone(),
                        });
                        state.push_log(format!("[auth] callback error: {message}"));
                        let _ = write_response(
                            &mut stream,
                            "200 OK",
                            "text/html; charset=utf-8",
                            callback_page("登录失败，可以返回 Kiya Agent 重试。"),
                        );
                        return;
                    }

                    match (code, state_token) {
                        (Some(code), Some(state_token)) => {
                            state.set_callback(CallbackPayload::Code {
                                code,
                                state: state_token,
                            });
                            state.push_log("[auth] authorization code received");
                            let _ = write_response(
                                &mut stream,
                                "200 OK",
                                "text/html; charset=utf-8",
                                callback_page("登录完成，可以关闭这个页面并返回 Kiya Agent。"),
                            );
                        }
                        _ => {
                            state.set_callback(CallbackPayload::Error {
                                message: "缺少 code 或 state".into(),
                            });
                            let _ = write_response(
                                &mut stream,
                                "400 Bad Request",
                                "text/html; charset=utf-8",
                                callback_page("登录回调参数不完整，请返回 Kiya Agent 重试。"),
                            );
                        }
                    }
                }
                Err(error) => {
                    state.push_log(format!("[auth] invalid callback url: {error}"));
                    let _ = write_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        "invalid callback url",
                    );
                }
            }
        }
        _ => {
            let _ = write_response(
                &mut stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                "not found",
            );
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: impl AsRef<str>,
) -> std::io::Result<()> {
    let body = body.as_ref();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())
}

fn callback_page(message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Kiya Agent</title><style>body{{font-family:Segoe UI,sans-serif;background:#f7f7f5;color:#18181b;padding:48px;line-height:1.8}}main{{max-width:640px;margin:0 auto}}h1{{font-size:28px;font-weight:600;margin:0 0 12px}}p{{margin:0;color:#52525b}}</style></head><body><main><h1>Kiya Agent</h1><p>{message}</p></main></body></html>"
    )
}
