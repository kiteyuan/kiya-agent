use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::{
    models::{PiLaunchConfig, RemoteMcpServerConfig},
    services::aria2_rpc_secret,
};

#[cfg(target_os = "windows")]
use super::constants::CREATE_NO_WINDOW;

pub struct PiRuntimeLayout {
    pub working_dir: PathBuf,
    pub agent_dir: PathBuf,
    pub mcp_config_path: PathBuf,
    pub models_config_path: PathBuf,
    pub mcp_adapter_extension: String,
    pub local_mcp_command: String,
    pub local_mcp_args: Vec<String>,
    pub node_program: Option<PathBuf>,
    pub pi_entry: PathBuf,
}

pub fn resolve_pi_runtime_layout(app: &AppHandle) -> Result<PiRuntimeLayout, String> {
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
            let state_dir = resolve_bundled_runtime_state_dir(app)?;
            let agent_dir = state_dir.join("pi-agent");
            fs::create_dir_all(&agent_dir)
                .map_err(|error| format!("创建 Pi Agent 运行时目录失败: {error}"))?;
            let bundled_mcp_adapter = working_dir.join("node_modules").join("pi-mcp-adapter");
            let local_mcp_command = if let Some(program) = bundled_node.as_ref() {
                program.display().to_string()
            } else {
                "node".into()
            };

            return Ok(PiRuntimeLayout {
                mcp_config_path: agent_dir.join("mcp.json"),
                models_config_path: agent_dir.join("models.json"),
                mcp_adapter_extension: bundled_mcp_adapter.display().to_string(),
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
        mcp_adapter_extension: "npm:pi-mcp-adapter".into(),
        working_dir: project_dir.clone(),
        agent_dir,
        local_mcp_command: "node".into(),
        local_mcp_args: vec!["local-mcp/src/index.js".into()],
        node_program: None,
        pi_entry: local_pi_entry,
    })
}

pub fn build_command(runtime: &PiRuntimeLayout, launch: &PiLaunchConfig) -> Command {
    let program = runtime
        .node_program
        .as_ref()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("node"));

    let mut command = Command::new(program);
    configure_background_command(&mut command);
    for key in isolated_env_keys() {
        command.env_remove(key);
    }
    // API key is written to auth.json (see write_auth_config) to avoid argv exposure.
    command
        .arg(&runtime.pi_entry)
        .current_dir(&runtime.working_dir)
        .env("PI_TELEMETRY", "0")
        .env("PI_CODING_AGENT_DIR", &runtime.agent_dir)
        .arg("--provider")
        .arg(provider_key(launch))
        .arg("--model")
        .arg(launch.model_name.trim());
    command
}

pub fn write_mcp_config(
    runtime: &PiRuntimeLayout,
    remote_mcp_servers: &[RemoteMcpServerConfig],
    download_dir: &Path,
) -> Result<(), String> {
    let mut mcp_servers = json!({
        "kiya-local": {
            "command": runtime.local_mcp_command,
            "args": runtime.local_mcp_args,
            "env": {
                "KIYA_DOWNLOAD_DIR": download_dir.display().to_string(),
                "KIYA_ARIA2_RPC_SECRET": aria2_rpc_secret(),
            }
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

pub fn write_auth_config(runtime: &PiRuntimeLayout, launch: &PiLaunchConfig) -> Result<(), String> {
    let api_key = launch.model_api_key.trim();
    if api_key.is_empty() {
        return Err("请先填写 API 密钥".into());
    }

    let auth_path = runtime.agent_dir.join("auth.json");
    let provider = provider_key(launch);
    let payload = json!({
        provider: {
            "type": "api_key",
            "key": api_key,
        }
    });
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("序列化 auth.json 失败: {error}"))?;
    fs::write(&auth_path, content).map_err(|error| format!("写入 auth.json 失败: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&auth_path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

pub fn write_models_config(
    runtime: &PiRuntimeLayout,
    launch: &PiLaunchConfig,
) -> Result<(), String> {
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

pub fn validate_launch_config(launch: &PiLaunchConfig) -> Result<(), String> {
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
            return Err(format!(
                "MCP 服务 {} 的 URL 不能为空",
                display_server_name(server)
            ));
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

pub fn launch_signature(launch: &PiLaunchConfig) -> Result<String, String> {
    serde_json::to_string(launch).map_err(|error| format!("序列化启动配置失败: {error}"))
}

pub fn provider_key(launch: &PiLaunchConfig) -> &str {
    if launch.model_provider == "custom-openai" {
        "kiya-openai-compatible"
    } else {
        launch.model_provider.as_str()
    }
}

pub fn display_server_name(server: &RemoteMcpServerConfig) -> &str {
    if server.name.trim().is_empty() {
        server.id.trim()
    } else {
        server.name.trim()
    }
}

fn project_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法解析项目根目录".into())
}

fn resolve_bundled_runtime_state_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析 Pi Agent 数据目录: {error}"))?;
    let state_dir = app_data_dir.join("pi-runtime");
    fs::create_dir_all(&state_dir).map_err(|error| format!("无法创建 Pi Agent 数据目录: {error}"))?;
    Ok(state_dir)
}

fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
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
