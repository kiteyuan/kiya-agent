use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    models::{PiLaunchConfig, PiStreamEvent, PiToolCall, RemoteMcpServerConfig},
    services::RuntimePaths,
};

const PI_STREAM_EVENT: &str = "kiya://pi-stream";
const LOCAL_MCP_SERVER_ID: &str = "kiya-local";

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

        let runtime = resolve_pi_runtime_layout()?;
        write_mcp_config(&runtime, &launch.remote_mcp_servers)?;
        write_models_config(&runtime, launch)?;
        self.push_log(format!(
            "[pi] mcp.json generated at {}",
            runtime.mcp_config_path.display()
        ));
        self.push_log(format!(
            "[pi] models.json generated at {}",
            runtime.models_config_path.display()
        ));

        let runtime_paths = RuntimePaths::from_command(app);
        let download_dir = if launch.download_dir.trim().is_empty() {
            runtime_paths.download_dir.clone()
        } else {
            PathBuf::from(launch.download_dir.trim())
        };
        let mut command = build_command(&runtime, launch);
        command
            .env("KIYA_DOWNLOAD_DIR", &download_dir)
            .arg("--mode")
            .arg("rpc")
            .arg("-e")
            .arg("npm:pi-mcp-adapter")
            .arg("--no-session")
            .arg("--approve")
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

        let routed_message = build_routed_prompt(message, history_context);
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

fn project_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法解析项目根目录".into())
}

struct PiRuntimeLayout {
    working_dir: PathBuf,
    agent_dir: PathBuf,
    mcp_config_path: PathBuf,
    models_config_path: PathBuf,
    local_mcp_command: String,
    local_mcp_args: Vec<String>,
    node_program: Option<PathBuf>,
    pi_entry: PathBuf,
}

fn resolve_pi_runtime_layout() -> Result<PiRuntimeLayout, String> {
    let resource_root = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("resources")))
        .filter(|dir| dir.exists());
    let project_dir = project_root()?;

    if let Some(resource_root) = resource_root {
        let bundled_pi_entry = resource_root
            .join("pi-runtime")
            .join("node_modules")
            .join("@earendil-works")
            .join("pi-coding-agent")
            .join("dist")
            .join("cli.js");
        let bundled_local_mcp = resource_root.join("local-mcp.js");
        let bundled_node = [resource_root.join("node.exe"), resource_root.join("node")]
            .into_iter()
            .find(|candidate| candidate.exists());

        if bundled_pi_entry.exists() && bundled_local_mcp.exists() {
            let working_dir = resource_root.join("pi-runtime");
            let agent_dir = resource_root.join("runtime-state").join("pi-agent");
            fs::create_dir_all(&agent_dir)
                .map_err(|error| format!("创建打包运行时目录失败: {error}"))?;
            let local_mcp_command = if let Some(program) = bundled_node.as_ref() {
                program.display().to_string()
            } else {
                "node".into()
            };

            return Ok(PiRuntimeLayout {
                mcp_config_path: working_dir.join(".mcp.json"),
                models_config_path: agent_dir.join("models.json"),
                working_dir,
                agent_dir,
                local_mcp_command,
                local_mcp_args: vec![bundled_local_mcp.display().to_string()],
                node_program: bundled_node,
                pi_entry: bundled_pi_entry,
            });
        }
    }

    let local_pi_entry = project_dir
        .join("node_modules")
        .join("@earendil-works")
        .join("pi-coding-agent")
        .join("dist")
        .join("cli.js");
    if !local_pi_entry.exists() {
        return Err("未找到本地 Pi Agent，请先执行 npm install".into());
    }

    let agent_dir = project_dir.join(".kiya").join("pi-agent");
    fs::create_dir_all(&agent_dir).map_err(|error| format!("创建本地运行时目录失败: {error}"))?;

    Ok(PiRuntimeLayout {
        mcp_config_path: project_dir.join(".mcp.json"),
        models_config_path: agent_dir.join("models.json"),
        working_dir: project_dir.clone(),
        agent_dir,
        local_mcp_command: "node".into(),
        local_mcp_args: vec!["local-mcp/src/index.js".into()],
        node_program: None,
        pi_entry: local_pi_entry,
    })
}

fn build_command(runtime: &PiRuntimeLayout, launch: &PiLaunchConfig) -> Command {
    let program = runtime
        .node_program
        .as_ref()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("node"));

    let mut command = Command::new(program);
    for key in isolated_env_keys() {
        command.env_remove(key);
    }
    command
        .arg(&runtime.pi_entry)
        .current_dir(&runtime.working_dir)
        .env("PI_TELEMETRY", "0")
        .env("PI_CODING_AGENT_DIR", &runtime.agent_dir)
        .arg("--provider")
        .arg(provider_key(launch))
        .arg("--model")
        .arg(launch.model_name.trim())
        .arg("--api-key")
        .arg(launch.model_api_key.trim());
    command
}

fn write_mcp_config(
    runtime: &PiRuntimeLayout,
    remote_mcp_servers: &[RemoteMcpServerConfig],
) -> Result<(), String> {
    let mut mcp_servers = json!({
        "kiya-local": {
            "command": runtime.local_mcp_command,
            "args": runtime.local_mcp_args
        }
    });

    for server in remote_mcp_servers
        .iter()
        .filter(|server| server.enabled && !server.url.trim().is_empty())
    {
        let server_key = sanitize_server_key(server);
        let server_payload = match server.transport.as_str() {
            "streamable-http" => json!({
                "transport": "streamable-http",
                "url": server.url.trim(),
                "headers": server.headers,
                "lifecycle": "eager"
            }),
            "sse" => json!({
                "transport": "sse",
                "sseUrl": server.url.trim(),
                "headers": server.headers
            }),
            _ => return Err(format!("不支持的 MCP 传输方式: {}", server.transport)),
        };
        mcp_servers[&server_key] = server_payload;
    }

    let payload = json!({
        "mcpServers": mcp_servers
    });

    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 mcp.json 失败: {error}"))?;
    fs::write(&runtime.mcp_config_path, content)
        .map_err(|error| format!("写入 mcp.json 失败: {error}"))
}

fn write_models_config(runtime: &PiRuntimeLayout, launch: &PiLaunchConfig) -> Result<(), String> {
    let payload = match launch.model_provider.as_str() {
        "openai" | "anthropic" | "openrouter" | "deepseek" => {
            if launch.model_base_url.trim().is_empty() {
                json!({ "providers": {} })
            } else {
                json!({
                    "providers": {
                        provider_key(launch): {
                            "baseUrl": launch.model_base_url.trim()
                        }
                    }
                })
            }
        }
        "custom-openai" => json!({
            "providers": {
                provider_key(launch): {
                    "baseUrl": launch.model_base_url.trim(),
                    "api": "openai-completions",
                    "compat": {
                        "supportsDeveloperRole": false,
                        "supportsReasoningEffort": false
                    },
                    "models": [
                        {
                            "id": launch.model_name.trim()
                        }
                    ]
                }
            }
        }),
        _ => return Err(format!("不支持的模型提供商: {}", launch.model_provider)),
    };

    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 models.json 失败: {error}"))?;
    fs::write(&runtime.models_config_path, content)
        .map_err(|error| format!("写入 models.json 失败: {error}"))
}

fn build_routed_prompt(message: &str, history_context: Option<&str>) -> String {
    let download_file_tool = exposed_local_tool_name("download_file");
    let play_video_tool = exposed_local_tool_name("play_video");
    let show_images_tool = exposed_local_tool_name("show_images");
    let open_folder_tool = exposed_local_tool_name("open_folder");
    let routing_hint = [
        "你运行在 Kiya Agent 桌面端。",
        "本地 MCP 服务器 `kiya-local` 始终可用。",
        &format!(
            "当前应优先使用的本地工具名是 `{download_file_tool}`、`{play_video_tool}`、`{show_images_tool}`、`{open_folder_tool}`。它们分别对应底层 MCP 工具 `download_file`、`play_video`、`show_images`、`open_folder`。"
        ),
        &format!(
            "当用户要求下载直链文件、保存资源、开始下载时，优先调用 `{download_file_tool}`，不要只做能力介绍。"
        ),
        &format!(
            "调用 `{download_file_tool}` 时必须显式提供 `output` 参数，值只能是文件名本身且必须带后缀，不能包含目录路径。文件名应根据用户请求、资源标题或上下文推断，不要省略。"
        ),
        &format!(
            "当用户要求播放视频、打开视频直链、播放 mp4/http/https 媒体链接时，优先调用 `{play_video_tool}`，不要声称该工具不存在，也不要建议用户手动运行 shell 命令或外部播放器。"
        ),
        &format!(
            "调用 `{play_video_tool}` 时必须显式提供 `title` 参数。标题应使用用户提到的影片名、资源标题或上下文里最自然的名称，不要省略，也不要退回成 `play` 这类通用名。"
        ),
        &format!(
            "当用户要求展示图片、预览一组图片、轮播查看图片链接时，优先调用 `{show_images_tool}`，不要只返回图片 URL 或建议用户自己在浏览器里打开。"
        ),
        &format!(
            "调用 `{show_images_tool}` 时必须显式提供 `images` 参数，值是按展示顺序排列的图片 URL 或本地绝对路径数组；可在合适时提供 `title` 和 `startIndex`。"
        ),
        "如果用户提供了明确的可用 URL，并且意图已经足够清晰，应直接调用对应工具；只在参数缺失时再追问。",
    ]
    .join("\n");

    let trimmed_history = history_context
        .map(str::trim)
        .filter(|history| !history.is_empty());

    if let Some(history) = trimmed_history {
        return format!(
            "{routing_hint}\n\nRecent conversation context (oldest to newest):\n{history}\n\nLatest user request:\n{message}"
        );
    }

    format!("{routing_hint}\n\n用户请求：\n{message}")
}

fn exposed_local_tool_name(tool_name: &str) -> String {
    format!("{}_{}", LOCAL_MCP_SERVER_ID.replace('-', "_"), tool_name)
}

fn normalize_tool_name(tool_name: &str) -> String {
    let trimmed = tool_name.trim();
    let local_prefixes = [
        format!("{}_", LOCAL_MCP_SERVER_ID),
        format!("{}_", LOCAL_MCP_SERVER_ID.replace('-', "_")),
    ];

    for prefix in local_prefixes {
        if let Some(stripped) = trimmed.strip_prefix(&prefix) {
            return stripped.to_string();
        }
    }

    trimmed.to_string()
}

fn normalize_tool_detail(detail: &str) -> String {
    if let Some((tool_name, payload)) = detail.split_once(':') {
        return format!("{}: {}", normalize_tool_name(tool_name), payload.trim_start());
    }

    detail.to_string()
}

fn validate_launch_config(launch: &PiLaunchConfig) -> Result<(), String> {
    match launch.model_provider.as_str() {
        "openai" | "anthropic" | "openrouter" | "deepseek" | "custom-openai" => {}
        _ => return Err(format!("不支持的模型提供商: {}", launch.model_provider)),
    }

    if launch.model_name.trim().is_empty() {
        return Err("请先在设置页填写模型名称".into());
    }
    if launch.model_api_key.trim().is_empty() {
        return Err("请先在设置页填写模型 API Key".into());
    }
    if launch.model_provider == "custom-openai" && launch.model_base_url.trim().is_empty() {
        return Err("Custom OpenAI-Compatible 需要填写 Base URL".into());
    }
    for server in &launch.remote_mcp_servers {
        if !server.enabled {
            continue;
        }
        if server.id.trim().is_empty() {
            return Err("MCP server id 不能为空".into());
        }
        if server.url.trim().is_empty() {
            return Err(format!("MCP 服务 {} 的 URL 不能为空", display_server_name(server)));
        }
        match server.transport.as_str() {
            "streamable-http" | "sse" => {}
            _ => {
                return Err(format!(
                    "MCP 服务 {} 使用了不支持的 transport: {}",
                    display_server_name(server),
                    server.transport
                ))
            }
        }
    }
    Ok(())
}

fn launch_signature(launch: &PiLaunchConfig) -> Result<String, String> {
    serde_json::to_string(launch).map_err(|error| format!("序列化启动配置失败: {error}"))
}

fn provider_key(launch: &PiLaunchConfig) -> &str {
    if launch.model_provider == "custom-openai" {
        "kiya-openai-compatible"
    } else {
        launch.model_provider.as_str()
    }
}

fn isolated_env_keys() -> &'static [&'static str] {
    &[
        "PI_CODING_AGENT_DIR",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_BASE_URL",
        "AZURE_OPENAI_RESOURCE_NAME",
        "AZURE_OPENAI_API_VERSION",
    ]
}

fn sanitize_server_key(server: &RemoteMcpServerConfig) -> String {
    let raw = if server.id.trim().is_empty() {
        server.name.trim()
    } else {
        server.id.trim()
    };
    let mut value = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if value.is_empty() {
        value = "remote-mcp".into();
    }
    value
}

fn display_server_name(server: &RemoteMcpServerConfig) -> &str {
    if server.name.trim().is_empty() {
        server.id.trim()
    } else {
        server.name.trim()
    }
}

fn extract_tool_detail(payload: &Value) -> Option<String> {
    let tool_name = payload
        .pointer("/toolExecution/toolName")
        .and_then(Value::as_str)
        .or_else(|| payload.pointer("/toolExecution/name").and_then(Value::as_str))
        .or_else(|| payload.pointer("/toolName").and_then(Value::as_str))
        .or_else(|| payload.pointer("/name").and_then(Value::as_str))?;

    let detail = payload
        .pointer("/toolExecution/arguments")
        .or_else(|| payload.pointer("/toolExecution/args"))
        .or_else(|| payload.pointer("/arguments"))
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".into());

    if tool_name == "mcp" {
        return extract_wrapped_mcp_tool_detail(payload);
    }

    Some(format!("{tool_name}: {detail}"))
}

fn extract_wrapped_mcp_tool_detail(payload: &Value) -> Option<String> {
    let wrapper_args = payload
        .pointer("/toolExecution/args")
        .or_else(|| payload.pointer("/toolExecution/arguments"))
        .or_else(|| payload.pointer("/args"))
        .or_else(|| payload.pointer("/arguments"))?;

    if wrapper_args.get("describe").is_some() {
        return None;
    }

    let wrapped_tool_name = wrapper_args
        .get("tool")
        .and_then(Value::as_str)
        .map(normalize_tool_name)?;

    let wrapped_args = wrapper_args.get("args")?;
    let wrapped_detail = if let Some(raw_json) = wrapped_args.as_str() {
        serde_json::from_str::<Value>(raw_json).unwrap_or_else(|_| Value::String(raw_json.into()))
    } else {
        wrapped_args.clone()
    };

    Some(format!("{wrapped_tool_name}: {}", wrapped_detail))
}
