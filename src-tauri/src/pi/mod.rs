mod constants;
mod events;
mod prompt;
mod runtime;

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    models::{PiLaunchConfig, PiStreamEvent, PiToolCall},
    services::{aria2_rpc_secret, RuntimePaths},
};

use constants::PI_STREAM_EVENT;
use events::extract_tool_detail;
use prompt::{build_routed_prompt, normalize_tool_detail, normalize_tool_name};
use runtime::{
    build_command, launch_signature, resolve_pi_runtime_layout, validate_launch_config,
    write_auth_config, write_mcp_config, write_models_config,
};

#[derive(Clone)]
struct ActivePrompt {
    request_id: String,
    assistant_text: String,
    tool_calls: Vec<PiToolCall>,
    logs: Vec<String>,
    completed: bool,
    error: Option<String>,
}

impl ActivePrompt {
    fn new(request_id: String) -> Self {
        Self {
            request_id,
            assistant_text: String::new(),
            tool_calls: Vec::new(),
            logs: Vec::new(),
            completed: false,
            error: None,
        }
    }
}

#[derive(Clone)]
pub struct PiManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    prompt_lock: Arc<Mutex<()>>,
    active_prompt: Arc<Mutex<Option<ActivePrompt>>>,
    logs: Arc<Mutex<Vec<String>>>,
    launch_signature: Arc<Mutex<Option<String>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl Default for PiManager {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            prompt_lock: Arc::new(Mutex::new(())),
            active_prompt: Arc::new(Mutex::new(None)),
            logs: Arc::new(Mutex::new(vec!["[pi] runtime not started".into()])),
            launch_signature: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }
}

pub type SharedPiManager = Arc<PiManager>;

impl PiManager {
    pub fn logs(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.clone())
            .unwrap_or_else(|_| vec!["[pi] failed to read logs".into()])
    }

    pub fn ensure_started(&self, app: &AppHandle, launch: &PiLaunchConfig) -> Result<(), String> {
        validate_launch_config(launch)?;
        self.set_app_handle(app.clone());
        let next_signature = launch_signature(launch)?;

        if self.stdin.lock().map_err(lock_error)?.is_some() {
            let current_signature = self.launch_signature.lock().map_err(lock_error)?.clone();
            if current_signature.as_deref() == Some(next_signature.as_str()) {
                return Ok(());
            }
            self.stop_runtime("[pi] restarting runtime to apply updated config");
        }

        let runtime = resolve_pi_runtime_layout(app)?;
        let runtime_paths = RuntimePaths::from_command(app);
        let download_dir = if launch.download_dir.trim().is_empty() {
            runtime_paths.download_dir.clone()
        } else {
            PathBuf::from(launch.download_dir.trim())
        };
        write_mcp_config(&runtime, &launch.remote_mcp_servers, &download_dir)?;
        write_models_config(&runtime, launch)?;
        write_auth_config(&runtime, launch)?;
        self.push_log(format!(
            "[pi] mcp.json generated at {}",
            runtime.mcp_config_path.display()
        ));
        self.push_log(format!(
            "[pi] models.json generated at {}",
            runtime.models_config_path.display()
        ));

        let mut command = build_command(&runtime, launch);
        command
            .env("KIYA_DOWNLOAD_DIR", &download_dir)
            .env("KIYA_ARIA2_RPC_SECRET", aria2_rpc_secret())
            .arg("--mode")
            .arg("rpc")
            .arg("-e")
            .arg(&runtime.mcp_adapter_extension)
            .arg("--no-session");

        if launch.auto_approve_tools {
            command.arg("--approve");
            self.push_log("[pi] auto-approve tools enabled");
        } else {
            self.push_log("[pi] auto-approve tools disabled");
        }

        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 Pi Agent: {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Pi Agent stdout 不可用".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Pi Agent stderr 不可用".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Pi Agent stdin 不可用".to_string())?;

        self.push_log(format!(
            "[pi] rpc runtime started with {}",
            runtime.pi_entry.display()
        ));

        if let Ok(mut child_slot) = self.child.lock() {
            *child_slot = Some(child);
        }
        if let Ok(mut stdin_slot) = self.stdin.lock() {
            *stdin_slot = Some(stdin);
        }
        if let Ok(mut signature_slot) = self.launch_signature.lock() {
            *signature_slot = Some(next_signature);
        }

        self.spawn_stdout_reader(stdout);
        self.spawn_stderr_reader(stderr);
        Ok(())
    }

    pub fn start_prompt(
        &self,
        app: &AppHandle,
        launch: &PiLaunchConfig,
        request_id: &str,
        message: &str,
        history_context: Option<&str>,
    ) -> Result<(), String> {
        let _prompt_guard = self.prompt_lock.lock().map_err(lock_error)?;
        self.ensure_started(app, launch)?;

        if self
            .active_prompt
            .lock()
            .map_err(lock_error)?
            .as_ref()
            .is_some_and(|prompt| !prompt.completed && prompt.error.is_none())
        {
            return Err("上一轮回复仍在生成，请稍后再试".into());
        }

        {
            let mut state = self.active_prompt.lock().map_err(lock_error)?;
            *state = Some(ActivePrompt::new(request_id.to_string()));
        }

        self.emit_stream_event(PiStreamEvent {
            request_id: request_id.to_string(),
            stage: "start".into(),
            delta: None,
            assistant_text: None,
            tool_call: None,
            message: None,
            logs: None,
        });

        let routed_message = build_routed_prompt(message, history_context, launch);
        let command = json!({
            "id": request_id,
            "type": "prompt",
            "message": routed_message,
        });
        if let Err(error) = self.write_command(&command) {
            self.clear_active_prompt();
            return Err(error);
        }

        let manager = self.clone();
        let timeout_request_id = request_id.to_string();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(300);
            while Instant::now() <= deadline {
                thread::sleep(Duration::from_millis(250));
                let is_active = manager
                    .active_prompt
                    .lock()
                    .ok()
                    .and_then(|state| state.as_ref().cloned())
                    .is_some_and(|prompt| prompt.request_id == timeout_request_id);
                if !is_active {
                    return;
                }
            }

            manager.mark_error_for_request(&timeout_request_id, "Pi Agent 响应超时");
        });

        Ok(())
    }

    pub fn write_command(&self, payload: &Value) -> Result<(), String> {
        let mut stdin_slot = self.stdin.lock().map_err(lock_error)?;
        let stdin = stdin_slot
            .as_mut()
            .ok_or_else(|| "Pi Agent 尚未就绪".to_string())?;
        let line = format!("{payload}\n");
        stdin
            .write_all(line.as_bytes())
            .map_err(|error| format!("写入 Pi Agent 命令失败: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("刷新 Pi Agent 命令失败: {error}"))?;
        Ok(())
    }

    fn spawn_stdout_reader(&self, stdout: ChildStdout) {
        let manager = self.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = String::new();

            loop {
                buffer.clear();
                match reader.read_line(&mut buffer) {
                    Ok(0) => {
                        manager.push_log("[pi] stdout closed");
                        manager.mark_error("Pi Agent 进程已退出");
                        break;
                    }
                    Ok(_) => {
                        let line = buffer.trim_end_matches(['\r', '\n']);
                        if line.is_empty() {
                            continue;
                        }
                        manager.handle_stdout_line(line);
                    }
                    Err(error) => {
                        manager.push_log(format!("[pi] stdout read error: {error}"));
                        manager.mark_error(format!("读取 Pi Agent 输出失败: {error}"));
                        break;
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(&self, stderr: ChildStderr) {
        let manager = self.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = String::new();
            loop {
                buffer.clear();
                match reader.read_line(&mut buffer) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = buffer.trim_end_matches(['\r', '\n']);
                        if line.is_empty() {
                            continue;
                        }
                        manager.push_log(format!("[pi:stderr] {line}"));
                        if line.contains("auth") || line.contains("model") {
                            manager.push_prompt_log(format!("[pi:stderr] {line}"));
                        }
                    }
                    Err(error) => {
                        manager.push_log(format!("[pi] stderr read error: {error}"));
                        break;
                    }
                }
            }
        });
    }

    fn handle_stdout_line(&self, line: &str) {
        self.push_log(format!("[pi:event] {line}"));

        let parsed = match serde_json::from_str::<Value>(line) {
            Ok(value) => value,
            Err(error) => {
                self.push_log(format!("[pi] invalid json line: {error}"));
                return;
            }
        };

        let event_type = parsed
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match event_type {
            "response" => {
                if parsed
                    .get("success")
                    .and_then(Value::as_bool)
                    .is_some_and(|success| !success)
                {
                    let message = parsed
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Pi Agent 拒绝了当前请求");
                    self.mark_error(message.to_string());
                }
            }
            "message_update" => {
                if parsed
                    .get("assistantMessageEvent")
                    .and_then(|event| event.get("type"))
                    .and_then(Value::as_str)
                    == Some("text_delta")
                {
                    if let Some(delta) = parsed
                        .get("assistantMessageEvent")
                        .and_then(|event| event.get("delta"))
                        .and_then(Value::as_str)
                    {
                        self.append_text(delta);
                    }
                }
            }
            "tool_execution_start" => {
                if let Some(detail) = extract_tool_detail(&parsed) {
                    self.push_tool_call(detail);
                }
            }
            "tool_execution_end" => {
                if let Some(detail) = extract_tool_detail(&parsed) {
                    self.push_prompt_log(format!("[tool:end] {detail}"));
                }
            }
            "agent_end" => {
                self.complete_prompt();
            }
            _ => {}
        }
    }

    fn append_text(&self, delta: &str) {
        let mut request_id = None;
        if let Ok(mut prompt) = self.active_prompt.lock() {
            if let Some(current) = prompt.as_mut() {
                current.assistant_text.push_str(delta);
                request_id = Some(current.request_id.clone());
            }
        }

        if let Some(request_id) = request_id {
            self.emit_stream_event(PiStreamEvent {
                request_id,
                stage: "text-delta".into(),
                delta: Some(delta.to_string()),
                assistant_text: None,
                tool_call: None,
                message: None,
                logs: None,
            });
        }
    }

    fn push_tool_call(&self, detail: String) {
        let mut payload = None;
        if let Ok(mut prompt) = self.active_prompt.lock() {
            if let Some(current) = prompt.as_mut() {
                let tool_name = detail
                    .split_once(':')
                    .map(|(tool, _)| normalize_tool_name(tool))
                    .unwrap_or_else(|| "tool".into());
                let normalized_detail = normalize_tool_detail(&detail);
                let tool_call = PiToolCall {
                    tool: tool_name,
                    detail: normalized_detail.clone(),
                };
                current.tool_calls.push(tool_call.clone());
                current.logs.push(format!("[tool] {normalized_detail}"));
                payload = Some(PiStreamEvent {
                    request_id: current.request_id.clone(),
                    stage: "tool-call".into(),
                    delta: None,
                    assistant_text: None,
                    tool_call: Some(tool_call),
                    message: None,
                    logs: None,
                });
            }
        }

        if let Some(payload) = payload {
            self.emit_stream_event(payload);
        }
    }

    fn push_prompt_log(&self, message: String) {
        if let Ok(mut prompt) = self.active_prompt.lock() {
            if let Some(current) = prompt.as_mut() {
                current.logs.push(message);
            }
        }
    }

    fn mark_error(&self, message: impl Into<String>) {
        self.mark_error_for_request("", message);
    }

    fn push_log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(message.into());
        }
    }

    fn complete_prompt(&self) {
        let completed = self
            .active_prompt
            .lock()
            .ok()
            .and_then(|mut prompt| prompt.take());

        if let Some(current) = completed {
            self.emit_stream_event(PiStreamEvent {
                request_id: current.request_id,
                stage: "complete".into(),
                delta: None,
                assistant_text: Some(current.assistant_text),
                tool_call: None,
                message: None,
                logs: Some(current.logs),
            });
        }
    }

    fn clear_active_prompt(&self) {
        if let Ok(mut prompt) = self.active_prompt.lock() {
            *prompt = None;
        }
    }

    fn mark_error_for_request(&self, request_id: &str, message: impl Into<String>) {
        let message = message.into();
        let mut payload = None;
        if let Ok(mut prompt) = self.active_prompt.lock() {
            if let Some(current) = prompt.as_ref() {
                if request_id.is_empty() || current.request_id == request_id {
                    payload = Some(PiStreamEvent {
                        request_id: current.request_id.clone(),
                        stage: "error".into(),
                        delta: None,
                        assistant_text: None,
                        tool_call: None,
                        message: Some(message.clone()),
                        logs: Some(current.logs.clone()),
                    });
                    *prompt = None;
                }
            }
        }
        self.push_log(format!("[pi:error] {message}"));
        if let Some(payload) = payload {
            self.emit_stream_event(payload);
        }
    }

    fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut handle) = self.app_handle.lock() {
            *handle = Some(app);
        }
    }

    fn emit_stream_event(&self, payload: PiStreamEvent) {
        if let Ok(handle) = self.app_handle.lock() {
            if let Some(app) = handle.as_ref() {
                let _ = app.emit(PI_STREAM_EVENT, payload);
            }
        }
    }

    fn stop_runtime(&self, reason: &str) {
        self.push_log(reason);

        if let Ok(mut stdin_slot) = self.stdin.lock() {
            *stdin_slot = None;
        }
        if let Ok(mut child_slot) = self.child.lock() {
            if let Some(child) = child_slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *child_slot = None;
        }
        if let Ok(mut signature_slot) = self.launch_signature.lock() {
            *signature_slot = None;
        }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Pi Agent 状态锁定失败".into()
}
