import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { LazyStore } from "@tauri-apps/plugin-store";
import axios from "axios";

import type {
  AppBootstrapStatus,
  ChatConversationSummary,
  ChatMessage,
  DownloadTask,
  LocalConfig,
  ModelProvider,
  PiStreamEvent,
  PlaylistItem,
  RemoteMcpServer,
  RemoteMcpTransport,
  RuntimeDefaults,
} from "@/types/app";

export const apiClient = axios.create({
  timeout: 10_000,
});

const embeddedRemoteMcpServers: RemoteMcpServer[] = [
  {
    id: "magnet",
    name: "Magnet",
    enabled: true,
    transport: "streamable-http",
    url: "https://magnet.kiteyuan.info/api/v1/mcp",
    headers: {},
    isEmbedded: true,
  },
  {
    id: "magnetflow",
    name: "MagnetFlow",
    enabled: true,
    transport: "streamable-http",
    url: "https://mybt.kiteyuan.info/api/v1/mcp",
    headers: {},
    isEmbedded: true,
  },
];

export const defaultBootstrapStatus: AppBootstrapStatus = {
  aria2: "ready",
  localMcp: "ready",
  piAgentConfig: "generated",
};

function getPreviewRuntimeTarget(): string {
  if (typeof navigator === "undefined") {
    return "windows-x64";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("mac")) {
    return "darwin-arm64";
  }
  if (userAgent.includes("linux")) {
    return "linux-x64";
  }
  return "windows-x64";
}

function getPreviewDownloadDir(runtimeTarget: string): string {
  if (runtimeTarget.startsWith("darwin")) {
    return "/Users/runner/Downloads";
  }
  if (runtimeTarget.startsWith("linux")) {
    return "/home/runner/Downloads";
  }
  return "C:/Users/runner/Downloads";
}

const previewRuntimeDefaults: RuntimeDefaults = {
  runtimeTarget: getPreviewRuntimeTarget(),
  downloadDir: getPreviewDownloadDir(getPreviewRuntimeTarget()),
};

export const defaultConfig: LocalConfig = {
  downloadDir: previewRuntimeDefaults.downloadDir,
  remoteMcpServers: embeddedRemoteMcpServers,
  localMcpPort: 17321,
  aria2RpcPort: 16800,
  modelProvider: "deepseek",
  modelName: "deepseek-v4-flash",
  modelApiKey: "",
  modelBaseUrl: "",
};

interface AppStatusPayload {
  status: AppBootstrapStatus;
  logs: string[];
}

export interface McpConnectionTestResult {
  ok: boolean;
  statusCode?: number;
  message: string;
}

const PI_STREAM_EVENT = "kiya://pi-stream";

const CONFIG_STORE_KEY = "localConfig";
const CHAT_CONVERSATIONS_STORE_KEY = "chatConversations";
const CHAT_MESSAGES_STORE_KEY = "chatMessagesByConversation";
const DOWNLOAD_TASKS_STORE_KEY = "downloadTasks";
const PLAYLIST_ITEMS_STORE_KEY = "playlistItems";
const STORE_FILE_NAME = import.meta.env.DEV
  ? "kiya-agent.dev.store.json"
  : "kiya-agent.store.json";
const store = new LazyStore(STORE_FILE_NAME, {
  defaults: {},
  autoSave: true,
});

function normalizeSavedModelDefaults(
  config: Partial<LocalConfig> | null,
): Partial<LocalConfig> | null {
  if (!config) {
    return null;
  }

  const provider = config.modelProvider;
  const modelName = config.modelName?.trim();
  const isLegacyDefault =
    provider === "openai" &&
    (!modelName || modelName === "gpt-4.1-mini");

  if (!provider || isLegacyDefault) {
    return {
      ...config,
      modelProvider: "deepseek",
      modelName: "deepseek-v4-flash",
    };
  }

  return config;
}

function isTauriRuntime() {
  return isTauri();
}

export async function saveConfig(config: LocalConfig): Promise<void> {
  if (isTauriRuntime()) {
    await store.set(CONFIG_STORE_KEY, config);
    await store.save();
    return;
  }

  localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(config));
}

export async function loadConfig(): Promise<Partial<LocalConfig> | null> {
  if (isTauriRuntime()) {
    const config = normalizeSavedModelDefaults(
      await store.get<Partial<LocalConfig>>(CONFIG_STORE_KEY),
    );
    return config
      ? {
          ...config,
          remoteMcpServers: mergeRemoteMcpServers(config.remoteMcpServers),
        }
      : null;
  }

  const rawConfig = localStorage.getItem(CONFIG_STORE_KEY);
  if (!rawConfig) {
    return null;
  }

  const parsed = normalizeSavedModelDefaults(
    JSON.parse(rawConfig) as Partial<LocalConfig>,
  );
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    remoteMcpServers: mergeRemoteMcpServers(parsed.remoteMcpServers),
  };
}

export function mergeBootstrapStatus(
  overrides?: Partial<AppBootstrapStatus>,
): AppBootstrapStatus {
  return {
    ...defaultBootstrapStatus,
    ...overrides,
  };
}

export async function bootstrapServices(): Promise<AppBootstrapStatus> {
  if (isTauriRuntime()) {
    const payload = await invoke<AppStatusPayload>("read_app_status");
    return payload.status;
  }

  return mergeBootstrapStatus();
}

export async function readAppStatusDetails(): Promise<AppStatusPayload> {
  if (isTauriRuntime()) {
    return invoke<AppStatusPayload>("read_app_status");
  }

  return {
    status: mergeBootstrapStatus(),
    logs: [
      "[bootstrap] aria2 ready",
      "[bootstrap] local mcp ready",
    ],
  };
}

export async function readRuntimeDefaults(): Promise<RuntimeDefaults> {
  if (isTauriRuntime()) {
    return invoke<RuntimeDefaults>("read_runtime_defaults");
  }

  return previewRuntimeDefaults;
}

export async function streamPiAgent(
  message: string,
  config: LocalConfig,
  historyMessages: ChatMessage[],
  onEvent: (event: PiStreamEvent) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    onEvent({
      requestId: crypto.randomUUID(),
      stage: "complete",
      assistantText:
        "当前仍在浏览器预览模式，Pi Agent RPC 只会在 Tauri 桌面环境中启动。",
      logs: ["[pi] preview mode fallback"],
    });
    return;
  }

  const requestId = crypto.randomUUID();
  const launchConfig = buildPiLaunchConfig(config);

  await new Promise<void>((resolve, reject) => {
    void (async () => {
      const unlisten = await listen<PiStreamEvent>(PI_STREAM_EVENT, (event) => {
        if (event.payload.requestId !== requestId) {
          return;
        }

        onEvent(event.payload);

        if (event.payload.stage === "complete") {
          void unlisten();
          resolve();
        }

        if (event.payload.stage === "error") {
          void unlisten();
          reject(new Error(event.payload.message ?? "Pi Agent 执行失败"));
        }
      });

      try {
        await invoke<void>("prompt_pi_agent", {
          requestId,
          message,
          historyContext: formatPromptHistory(historyMessages),
          config: launchConfig,
        });
      } catch (error) {
        await unlisten();
        reject(
          new Error(
            normalizeDesktopError(
              error,
              "Pi Agent 当前不可用，请检查模型与认证配置。",
            ),
          ),
        );
      }
    })().catch(reject);
  });
}

export function normalizeDesktopError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed || fallback;
  }

  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      const trimmed = error.message.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    if ("toString" in error && typeof error.toString === "function") {
      const text = error.toString().trim();
      if (text && text !== "[object Object]") {
        return text;
      }
    }
  }

  return fallback;
}

const PROMPT_HISTORY_LIMIT = 16;

function formatPromptHistory(messages: ChatMessage[]): string {
  const recentMessages = messages
    .filter((message) => {
      if (message.streaming) {
        return false;
      }

      if (message.role === "tool") {
        return Boolean(
          message.toolCall?.tool?.trim() || message.content.trim(),
        );
      }

      return Boolean(message.content.trim());
    })
    .slice(-PROMPT_HISTORY_LIMIT);

  return recentMessages
    .map((message) => {
      if (message.role === "tool") {
        const toolName = message.toolCall?.tool?.trim() || "tool";
        const detail = message.toolCall?.detail?.trim() || message.content.trim();
        return `[tool] ${toolName}: ${detail}`;
      }

      const roleLabel = message.role === "user" ? "user" : "assistant";
      return `[${roleLabel}] ${message.content.trim()}`;
    })
    .join("\n\n");
}

export async function testMcpServer(
  server: RemoteMcpServer,
): Promise<McpConnectionTestResult> {
  const resolvedServer = server;

  if (!isTauriRuntime()) {
    return {
      ok: true,
      statusCode: 200,
      message: "预览模式跳过真实 MCP 探测",
    };
  }

  return invoke<McpConnectionTestResult>("test_mcp_server", {
    url: resolvedServer.url,
    headers: resolvedServer.headers,
  });
}

export async function testModelConnection(
  config: LocalConfig,
): Promise<McpConnectionTestResult> {
  if (!isTauriRuntime()) {
    return {
      ok: true,
      statusCode: 200,
      message: "预览模式跳过真实模型探测",
    };
  }

  return invoke<McpConnectionTestResult>("test_model_connection", {
    config: buildPiLaunchConfig(config),
  });
}

export async function submitDownload(
  query: string,
  downloadDir = defaultConfig.downloadDir,
  output?: string,
): Promise<DownloadTask> {
  const title = query.trim() || "未命名资源";

  if (isTauriRuntime()) {
    const result = await invoke<DownloadTask>("submit_download_request", {
      url: query,
      output,
      downloadDir: downloadDir,
    });
    return result;
  }

  return {
    id: crypto.randomUUID(),
    name: output?.replace(/\.[^/.]+$/, "") || title,
    status: "downloading",
    progress: 24,
    speed: "8.4 MB/s",
    createdAtMs: Date.now(),
    filePath: `${downloadDir}/${output ?? `${title}.mp4`}`,
    source: "远程 MCP",
    downloadUrl: query,
  };
}

export async function playVideo(task: DownloadTask): Promise<string> {
  return openMediaSource(task.filePath);
}

export async function openMediaSource(source: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("open_media_file", {
      filePath: source,
    });
  }

  return `已请求播放器打开 ${source}`;
}

export async function openFolder(targetPath?: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("open_folder_path", {
      targetPath: targetPath ?? defaultConfig.downloadDir,
    });
  }

  return targetPath ?? defaultConfig.downloadDir;
}

export async function openExternalUrl(url: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("open_external_url", {
      url,
    });
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export async function selectDownloadDirectory(
  currentPath?: string,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: currentPath?.trim() || undefined,
    title: "选择下载目录",
  });

  if (typeof selected === "string") {
    return selected;
  }

  return null;
}

export async function listDownloadTasks(): Promise<DownloadTask[]> {
  if (isTauriRuntime()) {
    return invoke<DownloadTask[]>("list_download_tasks");
  }

  return getInitialDownloads(defaultConfig.downloadDir);
}

export async function listDownloadHistory(): Promise<DownloadTask[]> {
  if (isTauriRuntime()) {
    return invoke<DownloadTask[]>("list_download_history");
  }

  const rawTasks = localStorage.getItem(DOWNLOAD_TASKS_STORE_KEY);
  if (!rawTasks) {
    return [];
  }

  try {
    return JSON.parse(rawTasks) as DownloadTask[];
  } catch {
    return [];
  }
}

export async function saveDownloadHistory(tasks: DownloadTask[]): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("save_download_history", {
      tasks,
    });
    return;
  }

  localStorage.setItem(DOWNLOAD_TASKS_STORE_KEY, JSON.stringify(tasks));
}

export async function pauseDownload(aria2Gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("pause_download_task", {
    aria2Gid,
  });
}

export async function resumeDownload(aria2Gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("resume_download_task", {
    aria2Gid,
  });
}

export async function clearDownloadTask(
  task: Pick<DownloadTask, "status" | "aria2Gid" | "filePath">,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("clear_download_task", {
    aria2Gid: task.aria2Gid ?? null,
    filePath: task.filePath,
    deleteFiles: task.status !== "completed",
  });
}

export async function listPlaylistHistory(): Promise<PlaylistItem[]> {
  if (isTauriRuntime()) {
    return invoke<PlaylistItem[]>("list_playlist_history");
  }

  const rawItems = localStorage.getItem(PLAYLIST_ITEMS_STORE_KEY);
  if (!rawItems) {
    return [];
  }

  try {
    return JSON.parse(rawItems) as PlaylistItem[];
  } catch {
    return [];
  }
}

export async function savePlaylistHistory(items: PlaylistItem[]): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("save_playlist_history", {
      items,
    });
    return;
  }

  localStorage.setItem(PLAYLIST_ITEMS_STORE_KEY, JSON.stringify(items));
}

export async function listChatConversations(): Promise<ChatConversationSummary[]> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary[]>("list_chat_conversations");
  }

  const rawConversations = localStorage.getItem(CHAT_CONVERSATIONS_STORE_KEY);
  if (!rawConversations) {
    return [];
  }

  try {
    return (JSON.parse(rawConversations) as Array<Partial<ChatConversationSummary>>).map(
      (conversation) => ({
        id: conversation.id ?? crypto.randomUUID(),
        title: conversation.title ?? "新会话",
        createdAtMs: conversation.createdAtMs ?? Date.now(),
        updatedAtMs: conversation.updatedAtMs ?? conversation.createdAtMs ?? Date.now(),
        messageCount: conversation.messageCount ?? 0,
      }),
    );
  } catch {
    return [];
  }
}

export async function createChatConversation(): Promise<ChatConversationSummary> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary>("create_chat_conversation");
  }

  const now = Date.now();
  const conversation: ChatConversationSummary = {
    id: crypto.randomUUID(),
    title: "新会话",
    createdAtMs: now,
    updatedAtMs: now,
    messageCount: 0,
  };
  const conversations = await listChatConversations();
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify([conversation, ...conversations]),
  );
  return conversation;
}

export async function deleteChatConversation(conversationId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("delete_chat_conversation", {
      conversationId,
    });
    return;
  }

  const conversations = await listChatConversations();
  const nextConversations = conversations.filter((item) => item.id !== conversationId);
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify(nextConversations),
  );

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  if (!rawMessages) {
    return;
  }

  try {
    const messageMap = JSON.parse(rawMessages) as Record<string, ChatMessage[]>;
    delete messageMap[conversationId];
    localStorage.setItem(CHAT_MESSAGES_STORE_KEY, JSON.stringify(messageMap));
  } catch {
    localStorage.removeItem(CHAT_MESSAGES_STORE_KEY);
  }
}

export async function loadChatMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  if (isTauriRuntime()) {
    return invoke<ChatMessage[]>("load_chat_messages", {
      conversationId,
    });
  }

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  if (!rawMessages) {
    return [];
  }

  try {
    const messageMap = JSON.parse(rawMessages) as Record<string, ChatMessage[]>;
    return messageMap[conversationId] ?? [];
  } catch {
    return [];
  }
}

export async function saveChatMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<ChatConversationSummary> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary>("save_chat_messages", {
      conversationId,
      messages,
    });
  }

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  const messageMap = rawMessages
    ? (JSON.parse(rawMessages) as Record<string, ChatMessage[]>)
    : {};
  messageMap[conversationId] = messages;
  localStorage.setItem(CHAT_MESSAGES_STORE_KEY, JSON.stringify(messageMap));

  const conversations = await listChatConversations();
  const now = Date.now();
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const title = firstUserMessage?.content.trim().slice(0, 40) || "新会话";
  const existing = conversations.find((conversation) => conversation.id === conversationId);
  const summary: ChatConversationSummary = {
    id: conversationId,
    title,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    messageCount: messages.length,
  };
  const nextConversations = [summary, ...conversations.filter((item) => item.id !== conversationId)]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify(nextConversations),
  );
  return summary;
}

export function getInitialMessages(): ChatMessage[] {
  return [];
}

export function getInitialDownloads(
  downloadDir = defaultConfig.downloadDir,
): DownloadTask[] {
  void downloadDir;
  return [];
}

export function getInitialPlaylist(
  downloadDir = defaultConfig.downloadDir,
): PlaylistItem[] {
  void downloadDir;
  return [];
}

export const modelProviderOptions: Array<{
  value: ModelProvider;
  label: string;
  defaultModel: string;
  baseUrlPlaceholder: string;
}> = [
  {
    value: "openai",
    label: "OpenAI 官方",
    defaultModel: "gpt-5.4",
    baseUrlPlaceholder: "可选，例如 https://api.openai.com/v1",
  },
  {
    value: "anthropic",
    label: "Anthropic 官方",
    defaultModel: "claude-sonnet-5",
    baseUrlPlaceholder: "可选，留空则使用官方地址",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-5",
    baseUrlPlaceholder: "可选，例如 https://openrouter.ai/api/v1",
  },
  {
    value: "deepseek",
    label: "DeepSeek 官方",
    defaultModel: "deepseek-v4-flash",
    baseUrlPlaceholder: "可选，留空则使用官方地址",
  },
  {
    value: "custom-openai",
    label: "自定义 OpenAI 兼容接口",
    defaultModel: "gpt-5.4-mini",
    baseUrlPlaceholder: "必填，例如 https://your-proxy.example.com/v1",
  },
];

export const modelNameOptionsByProvider: Partial<Record<ModelProvider, Array<{
  value: string;
  label: string;
}>>> = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  ],
  anthropic: [
    { value: "claude-fable-5", label: "Claude Fable 5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  deepseek: [
    { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { value: "deepseek-chat", label: "deepseek-chat（兼容别名，即将退场）" },
    { value: "deepseek-reasoner", label: "deepseek-reasoner（兼容别名，即将退场）" },
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5" },
    { value: "anthropic/claude-opus-4-8", label: "Anthropic: Claude Opus 4.8" },
    { value: "openai/gpt-5.5", label: "OpenAI: GPT-5.5" },
    { value: "deepseek/deepseek-v4-flash", label: "DeepSeek: V4 Flash" },
    { value: "openrouter/fusion", label: "OpenRouter: Fusion" },
    { value: "openrouter/owl-alpha", label: "OpenRouter: Owl Alpha" },
    { value: "openrouter/pareto-code", label: "OpenRouter: Pareto Code Router" },
  ],
};

export const remoteMcpTransportOptions: Array<{ value: RemoteMcpTransport; label: string }> = [
  { value: "streamable-http", label: "流式 HTTP" },
  { value: "sse", label: "SSE 长连接" },
];

export function buildPiLaunchConfig(config: LocalConfig) {
  return {
    ...config,
    remoteMcpServers: mergeRemoteMcpServers(config.remoteMcpServers),
  };
}

export function mergeRemoteMcpServers(
  savedServers?: RemoteMcpServer[],
): RemoteMcpServer[] {
  const persistedServers = savedServers ?? [];
  const persistedMap = new Map(persistedServers.map((server) => [server.id, server]));

  const embeddedServers = embeddedRemoteMcpServers.map((server) => {
    const saved = persistedMap.get(server.id);
    return saved
      ? {
          ...server,
          // Embedded MCP services are always active once configured.
          enabled: true,
          headers: saved.headers ?? {},
        }
      : server;
  });

  const customServers = persistedServers.filter(
    (server) => !embeddedRemoteMcpServers.some((item) => item.id === server.id),
  );

  return [...embeddedServers, ...customServers];
}
export function createRemoteMcpServer(
  patch?: Partial<RemoteMcpServer>,
): RemoteMcpServer {
  return {
    id: patch?.id ?? crypto.randomUUID(),
    name: patch?.name ?? "新 MCP",
    enabled: patch?.enabled ?? true,
    transport: patch?.transport ?? "streamable-http",
    url: patch?.url ?? "",
    headers: patch?.headers ?? {},
    isEmbedded: patch?.isEmbedded ?? false,
  };
}
