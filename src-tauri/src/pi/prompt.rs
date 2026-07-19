use crate::models::PiLaunchConfig;

use super::constants::LOCAL_MCP_SERVER_ID;
use super::runtime::display_server_name;

pub fn build_routed_prompt(
    message: &str,
    history_context: Option<&str>,
    launch: &PiLaunchConfig,
) -> String {
    let download_file_tool = exposed_local_tool_name("download_file");
    let play_video_tool = exposed_local_tool_name("play_video");
    let show_images_tool = exposed_local_tool_name("show_images");
    let open_folder_tool = exposed_local_tool_name("open_folder");
    let enabled_remote_servers = launch
        .remote_mcp_servers
        .iter()
        .filter(|server| server.enabled && !server.url.trim().is_empty())
        .map(|server| format!("{} ({})", display_server_name(server), server.id.trim()))
        .collect::<Vec<_>>();
    let remote_mcp_hint = if enabled_remote_servers.is_empty() {
        "当前没有启用任何远程 MCP 服务器。".to_string()
    } else {
        format!(
            "当前已启用的远程 MCP 服务器有：{}。",
            enabled_remote_servers.join("、")
        )
    };
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
    let routing_hint = [
        "你运行在 Kiya Agent 桌面端。",
        "本地 MCP 服务器 `kiya-local` 始终可用。",
        &remote_mcp_hint,
        "回答远程或外部 MCP 可用性时，必须以上面的服务器列表为准；如果列表非空，不要声称“当前没有任何外部 MCP 服务器”。",
        &routing_hint,
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

pub fn exposed_local_tool_name(tool_name: &str) -> String {
    format!("{}_{}", LOCAL_MCP_SERVER_ID.replace('-', "_"), tool_name)
}

pub fn normalize_tool_name(tool_name: &str) -> String {
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

pub fn normalize_tool_detail(detail: &str) -> String {
    if let Some((tool_name, payload)) = detail.split_once(':') {
        return format!("{}: {}", normalize_tool_name(tool_name), payload.trim_start());
    }

    detail.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::RemoteMcpServerConfig;

    #[test]
    fn strips_local_mcp_tool_prefixes() {
        assert_eq!(
            normalize_tool_name("kiya_local_download_file"),
            "download_file"
        );
        assert_eq!(
            normalize_tool_name("kiya-local_play_video"),
            "play_video"
        );
    }

    #[test]
    fn builds_prompt_with_remote_mcp_hint() {
        let launch = PiLaunchConfig {
            download_dir: "C:/Downloads".into(),
            remote_mcp_servers: vec![RemoteMcpServerConfig {
                id: "magnet".into(),
                name: "Magnet".into(),
                enabled: true,
                transport: "streamable-http".into(),
                url: "https://example.com/mcp".into(),
                headers: Default::default(),
            }],
            model_provider: "deepseek".into(),
            model_name: "deepseek-v4-flash".into(),
            model_api_key: "sk-test".into(),
            model_base_url: String::new(),
            auto_approve_tools: true,
        };

        let prompt = build_routed_prompt("下载这个", None, &launch);
        assert!(prompt.contains("Magnet (magnet)"));
        assert!(prompt.contains("kiya_local_download_file"));
    }
}
