use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrapStatus {
    pub aria2: String,
    pub local_mcp: String,
    pub pi_agent_config: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatusPayload {
    pub status: AppBootstrapStatus,
    pub logs: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDefaults {
    pub download_dir: String,
    pub runtime_target: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLaunchConfig {
    pub download_dir: String,
    pub remote_mcp_servers: Vec<RemoteMcpServerConfig>,
    pub model_provider: String,
    pub model_name: String,
    pub model_api_key: String,
    pub model_base_url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMcpServerConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiToolCall {
    pub tool: String,
    pub detail: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCall {
    pub tool: String,
    pub detail: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub created_at: Option<String>,
    pub tool_call: Option<ChatToolCall>,
    pub streaming: Option<bool>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub message_count: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiStreamEvent {
    pub request_id: String,
    pub stage: String,
    pub delta: Option<String>,
    pub assistant_text: Option<String>,
    pub tool_call: Option<PiToolCall>,
    pub message: Option<String>,
    pub logs: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionTestResult {
    pub ok: bool,
    pub status_code: Option<u16>,
    pub message: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub name: String,
    pub status: String,
    pub progress: u8,
    pub speed: String,
    pub total_bytes: Option<u64>,
    pub created_at_ms: Option<u64>,
    pub file_path: String,
    pub source: String,
    pub download_url: Option<String>,
    pub aria2_gid: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub title: String,
    pub source: String,
    pub kind: String,
    pub origin: String,
    pub added_at: String,
}
