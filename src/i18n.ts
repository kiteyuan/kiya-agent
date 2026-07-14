import { useAppStore } from "@/stores/app-store";
import type { AppLanguage, ModelProvider, RemoteMcpTransport } from "@/types/app";

type TranslationKey =
  | "app.tagline"
  | "app.openGithubRepo"
  | "app.newChat"
  | "app.recent"
  | "app.deleteConversationTitle"
  | "app.cancel"
  | "app.confirmDelete"
  | "app.service.magnetSearch"
  | "app.service.magnetDownload"
  | "app.service.llmModel"
  | "app.status.connected"
  | "app.status.disconnected"
  | "app.status.connecting"
  | "nav.downloads"
  | "nav.playlist"
  | "nav.settings"
  | "nav.diagnostics"
  | "diagnostics.title"
  | "diagnostics.description"
  | "diagnostics.refresh"
  | "diagnostics.refreshing"
  | "diagnostics.lastUpdated"
  | "diagnostics.lines"
  | "diagnostics.piLogs"
  | "diagnostics.bootstrapLogs"
  | "diagnostics.empty"
  | "diagnostics.loadFailed"
  | "chat.welcomeTitle"
  | "chat.welcomeDescription"
  | "chat.composerPlaceholder"
  | "chat.send"
  | "chat.generating"
  | "chat.toolCallingPrefix"
  | "chat.toolInvoked"
  | "chat.emptyReply"
  | "chat.agentUnavailable"
  | "downloads.status.completed"
  | "downloads.status.downloading"
  | "downloads.status.paused"
  | "downloads.status.failed"
  | "downloads.status.queued"
  | "downloads.waitingAria2"
  | "downloads.paused"
  | "downloads.eta"
  | "downloads.etaHoursMinutes"
  | "downloads.etaMinutesSeconds"
  | "downloads.etaSeconds"
  | "downloads.openFolder"
  | "downloads.pause"
  | "downloads.resume"
  | "downloads.retry"
  | "downloads.delete"
  | "downloads.clearHistory"
  | "downloads.clearHistoryTitle"
  | "downloads.clearHistoryDescription"
  | "downloads.clearing"
  | "playlist.play"
  | "playlist.delete"
  | "playlist.clearHistory"
  | "playlist.clearHistoryTitle"
  | "playlist.clearHistoryDescription"
  | "playlist.clearing"
  | "settings.languageSectionTitle"
  | "settings.languageSectionDescription"
  | "settings.interfaceLanguage"
  | "settings.language.zh-CN"
  | "settings.language.en"
  | "settings.downloadSectionTitle"
  | "settings.downloadDir"
  | "settings.browse"
  | "settings.browsing"
  | "settings.mcpSectionTitle"
  | "settings.getMcpToken"
  | "settings.enterMcpToken"
  | "settings.testConnection"
  | "settings.testing"
  | "settings.serverUnnamed"
  | "settings.enabled"
  | "settings.delete"
  | "settings.identifier"
  | "settings.name"
  | "settings.transport"
  | "settings.url"
  | "settings.requestHeadersJson"
  | "settings.modelSectionTitle"
  | "settings.provider"
  | "settings.modelName"
  | "settings.customModel"
  | "settings.apiKey"
  | "settings.baseUrl"
  | "settings.save"
  | "overlay.closePlayer"
  | "overlay.closeImagePreview"
  | "overlay.previousImage"
  | "overlay.nextImage"
  | "overlay.localPreviewDesktopOnly"
  | "overlay.localVideoDesktopOnly";

type TranslationDictionary = Record<TranslationKey, string>;

const translations: Record<AppLanguage, TranslationDictionary> = {
  "zh-CN": {
    "app.tagline": "磁力搜索、转存与播放",
    "app.openGithubRepo": "打开 Kiya Agent GitHub 仓库",
    "app.newChat": "新聊天",
    "app.recent": "最近",
    "app.deleteConversationTitle": "删除这条对话？",
    "app.cancel": "取消",
    "app.confirmDelete": "确认删除",
    "app.service.magnetSearch": "纸鸢搜索 MCP",
    "app.service.magnetDownload": "纸鸢下载 MCP",
    "app.service.llmModel": "LLM 模型",
    "app.status.connected": "已连接",
    "app.status.disconnected": "未连接",
    "app.status.connecting": "连接中",
    "nav.downloads": "下载记录",
    "nav.playlist": "播放历史",
    "nav.settings": "设置",
    "nav.diagnostics": "诊断日志",
    "diagnostics.title": "运行诊断",
    "diagnostics.description": "这里会直接显示 Pi Agent 运行日志，便于继续追查空回复、进程退出和配置问题。",
    "diagnostics.refresh": "刷新日志",
    "diagnostics.refreshing": "刷新中",
    "diagnostics.lastUpdated": "最近刷新 {value}",
    "diagnostics.lines": "{count} 条",
    "diagnostics.piLogs": "Pi 运行日志",
    "diagnostics.bootstrapLogs": "启动与本地服务日志",
    "diagnostics.empty": "当前还没有可显示的日志。",
    "diagnostics.loadFailed": "刷新诊断失败：{message}",
    "chat.welcomeTitle": "你好，我是 Kiya Agent",
    "chat.welcomeDescription": "想找什么资源？可以直接让我帮你搜索资源、转存磁力、下载文件，或者在线播放视频。",
    "chat.composerPlaceholder": "想聊点什么？",
    "chat.send": "发送",
    "chat.generating": "正在生成...",
    "chat.toolCallingPrefix": "正在调用 ",
    "chat.toolInvoked": "Pi Agent 调用了 {tool}",
    "chat.emptyReply": "Pi Agent 已收到请求，但本轮没有返回可显示文本。",
    "chat.agentUnavailable": "Pi Agent 当前不可用，请检查模型与认证配置。",
    "downloads.status.completed": "已完成",
    "downloads.status.downloading": "下载中",
    "downloads.status.paused": "已暂停",
    "downloads.status.failed": "失败",
    "downloads.status.queued": "排队中",
    "downloads.waitingAria2": "等待 aria2",
    "downloads.paused": "已暂停",
    "downloads.eta": "预计 {value}",
    "downloads.etaHoursMinutes": "{hours}小时{minutes}分",
    "downloads.etaMinutesSeconds": "{minutes}分{seconds}秒",
    "downloads.etaSeconds": "{seconds}秒",
    "downloads.openFolder": "打开 {name} 所在目录",
    "downloads.pause": "暂停 {name}",
    "downloads.resume": "开始 {name}",
    "downloads.retry": "重试 {name}",
    "downloads.delete": "删除 {name}",
    "downloads.clearHistory": "清空下载记录",
    "downloads.clearHistoryTitle": "清空下载记录？",
    "downloads.clearHistoryDescription": "已下载完成的本地文件不会删除。",
    "downloads.clearing": "清空中",
    "playlist.play": "播放 {name}",
    "playlist.delete": "删除 {name}",
    "playlist.clearHistory": "清空播放历史",
    "playlist.clearHistoryTitle": "清空播放历史？",
    "playlist.clearHistoryDescription": "这不会删除任何本地文件。",
    "playlist.clearing": "清空中",
    "settings.languageSectionTitle": "界面语言",
    "settings.languageSectionDescription": "切换 Kiya Agent 的界面显示语言。",
    "settings.interfaceLanguage": "显示语言",
    "settings.language.zh-CN": "中文",
    "settings.language.en": "English",
    "settings.downloadSectionTitle": "下载设置",
    "settings.downloadDir": "下载目录",
    "settings.browse": "浏览",
    "settings.browsing": "选择中",
    "settings.mcpSectionTitle": "MCP 服务",
    "settings.getMcpToken": "获取 MCP Token",
    "settings.enterMcpToken": "输入 MCP Token",
    "settings.testConnection": "测试连接",
    "settings.testing": "测试中",
    "settings.serverUnnamed": "未命名 MCP",
    "settings.enabled": "已启用",
    "settings.delete": "删除",
    "settings.identifier": "标识",
    "settings.name": "名称",
    "settings.transport": "传输方式",
    "settings.url": "地址",
    "settings.requestHeadersJson": "请求头 JSON",
    "settings.modelSectionTitle": "LLM 模型",
    "settings.provider": "提供方",
    "settings.modelName": "模型名称",
    "settings.customModel": "手动输入其他模型",
    "settings.apiKey": "API 密钥",
    "settings.baseUrl": "接口地址",
    "settings.save": "保存设置",
    "overlay.closePlayer": "关闭播放器",
    "overlay.closeImagePreview": "关闭图片预览",
    "overlay.previousImage": "上一张",
    "overlay.nextImage": "下一张",
    "overlay.localPreviewDesktopOnly": "当前预览仅在 Tauri 桌面环境中加载本地图片",
    "overlay.localVideoDesktopOnly": "当前预览仅在 Tauri 桌面环境中加载本地视频",
  },
  en: {
    "app.tagline": "Magnet Search, Save and Play",
    "app.openGithubRepo": "Open the Kiya Agent GitHub repository",
    "app.newChat": "New Chat",
    "app.recent": "Recent",
    "app.deleteConversationTitle": "Delete this conversation?",
    "app.cancel": "Cancel",
    "app.confirmDelete": "Delete",
    "app.service.magnetSearch": "Magnet Search MCP",
    "app.service.magnetDownload": "Magnet Download MCP",
    "app.service.llmModel": "LLM Model",
    "app.status.connected": "Connected",
    "app.status.disconnected": "Disconnected",
    "app.status.connecting": "Connecting",
    "nav.downloads": "Downloads",
    "nav.playlist": "Playback History",
    "nav.settings": "Settings",
    "nav.diagnostics": "Diagnostics",
    "diagnostics.title": "Runtime Diagnostics",
    "diagnostics.description": "Pi Agent runtime logs are shown here directly so we can keep tracing empty replies, process exits, and configuration issues.",
    "diagnostics.refresh": "Refresh Logs",
    "diagnostics.refreshing": "Refreshing",
    "diagnostics.lastUpdated": "Last refreshed {value}",
    "diagnostics.lines": "{count} lines",
    "diagnostics.piLogs": "Pi Runtime Logs",
    "diagnostics.bootstrapLogs": "Bootstrap and Local Service Logs",
    "diagnostics.empty": "No logs are available yet.",
    "diagnostics.loadFailed": "Failed to refresh diagnostics: {message}",
    "chat.welcomeTitle": "Hi, I'm Kiya Agent",
    "chat.welcomeDescription": "Looking for something? I can help search resources, save magnets, download files, or play videos online.",
    "chat.composerPlaceholder": "What would you like to do?",
    "chat.send": "Send",
    "chat.generating": "Generating...",
    "chat.toolCallingPrefix": "Calling ",
    "chat.toolInvoked": "Pi Agent called {tool}",
    "chat.emptyReply": "Pi Agent received the request, but this turn returned no visible text.",
    "chat.agentUnavailable": "Pi Agent is currently unavailable. Please check your model and authentication settings.",
    "downloads.status.completed": "Completed",
    "downloads.status.downloading": "Downloading",
    "downloads.status.paused": "Paused",
    "downloads.status.failed": "Failed",
    "downloads.status.queued": "Queued",
    "downloads.waitingAria2": "Waiting for aria2",
    "downloads.paused": "Paused",
    "downloads.eta": "ETA {value}",
    "downloads.etaHoursMinutes": "{hours}h {minutes}m",
    "downloads.etaMinutesSeconds": "{minutes}m {seconds}s",
    "downloads.etaSeconds": "{seconds}s",
    "downloads.openFolder": "Open folder for {name}",
    "downloads.pause": "Pause {name}",
    "downloads.resume": "Resume {name}",
    "downloads.retry": "Retry {name}",
    "downloads.delete": "Delete {name}",
    "downloads.clearHistory": "Clear download history",
    "downloads.clearHistoryTitle": "Clear download history?",
    "downloads.clearHistoryDescription": "Completed local files will not be deleted.",
    "downloads.clearing": "Clearing",
    "playlist.play": "Play {name}",
    "playlist.delete": "Delete {name}",
    "playlist.clearHistory": "Clear playback history",
    "playlist.clearHistoryTitle": "Clear playback history?",
    "playlist.clearHistoryDescription": "This will not delete any local files.",
    "playlist.clearing": "Clearing",
    "settings.languageSectionTitle": "Language",
    "settings.languageSectionDescription": "Choose the display language for the Kiya Agent interface.",
    "settings.interfaceLanguage": "Display Language",
    "settings.language.zh-CN": "Chinese",
    "settings.language.en": "English",
    "settings.downloadSectionTitle": "Download Settings",
    "settings.downloadDir": "Download Directory",
    "settings.browse": "Browse",
    "settings.browsing": "Browsing",
    "settings.mcpSectionTitle": "MCP Services",
    "settings.getMcpToken": "Get MCP Token",
    "settings.enterMcpToken": "Enter MCP Token",
    "settings.testConnection": "Test Connection",
    "settings.testing": "Testing",
    "settings.serverUnnamed": "Unnamed MCP",
    "settings.enabled": "Enabled",
    "settings.delete": "Delete",
    "settings.identifier": "Identifier",
    "settings.name": "Name",
    "settings.transport": "Transport",
    "settings.url": "URL",
    "settings.requestHeadersJson": "Request Headers JSON",
    "settings.modelSectionTitle": "LLM Model",
    "settings.provider": "Provider",
    "settings.modelName": "Model Name",
    "settings.customModel": "Enter another model manually",
    "settings.apiKey": "API Key",
    "settings.baseUrl": "Base URL",
    "settings.save": "Save Settings",
    "overlay.closePlayer": "Close player",
    "overlay.closeImagePreview": "Close image preview",
    "overlay.previousImage": "Previous image",
    "overlay.nextImage": "Next image",
    "overlay.localPreviewDesktopOnly": "Local image preview is only available in the Tauri desktop runtime",
    "overlay.localVideoDesktopOnly": "Local video preview is only available in the Tauri desktop runtime",
  },
};

type TranslationParams = Record<string, string | number>;

export function t(
  language: AppLanguage,
  key: TranslationKey,
  params?: TranslationParams,
) {
  let text = translations[language][key] ?? translations["zh-CN"][key] ?? key;
  if (!params) {
    return text;
  }

  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

export function getIntlLocale(language: AppLanguage) {
  return language === "en" ? "en-US" : "zh-CN";
}

export function getModelProviderLabel(
  language: AppLanguage,
  provider: ModelProvider,
) {
  const labels: Record<ModelProvider, string> =
    language === "en"
      ? {
          openai: "OpenAI",
          anthropic: "Anthropic",
          openrouter: "OpenRouter",
          deepseek: "DeepSeek",
          "custom-openai": "Custom OpenAI-Compatible API",
        }
      : {
          openai: "OpenAI 官方",
          anthropic: "Anthropic 官方",
          openrouter: "OpenRouter",
          deepseek: "DeepSeek 官方",
          "custom-openai": "自定义 OpenAI 兼容接口",
        };

  return labels[provider];
}

export function getRemoteTransportLabel(
  language: AppLanguage,
  transport: RemoteMcpTransport,
) {
  if (transport === "sse") {
    return language === "en" ? "SSE Long Connection" : "SSE 长连接";
  }

  return language === "en" ? "Streaming HTTP" : "流式 HTTP";
}

export function useI18n() {
  const language = useAppStore((state) => state.config.language);

  return {
    language,
    locale: getIntlLocale(language),
    t: (key: TranslationKey, params?: TranslationParams) => t(language, key, params),
  };
}
