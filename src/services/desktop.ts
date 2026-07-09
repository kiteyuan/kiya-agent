import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import axios from "axios";

import type {
  AppBootstrapStatus,
  AuthSession,
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
  oauthCallback: "ready",
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
    return "/Users/runner/Downloads/KiyaAgent";
  }
  if (runtimeTarget.startsWith("linux")) {
    return "/home/runner/Downloads/KiyaAgent";
  }
  return "C:/Users/runner/Downloads/KiyaAgent";
}

const previewRuntimeDefaults: RuntimeDefaults = {
  runtimeTarget: getPreviewRuntimeTarget(),
  downloadDir: getPreviewDownloadDir(getPreviewRuntimeTarget()),
};

export const defaultConfig: LocalConfig = {
  downloadDir: previewRuntimeDefaults.downloadDir,
  remoteMcpServers: embeddedRemoteMcpServers,
  casdoorBaseUrl: "https://auth.kiteyuan.info",
  casdoorClientId: "b3ed2dcbc9803ecdc3d0",
  casdoorScope: "openid profile email offline_access",
  casdoorRedirectUri: "http://127.0.0.1:14321/callback",
  localMcpPort: 17321,
  aria2RpcPort: 16800,
  modelProvider: "openai",
  modelName: "gpt-4.1-mini",
  modelApiKey: "",
  modelBaseUrl: "",
};

interface AppStatusPayload {
  status: AppBootstrapStatus;
  logs: string[];
}

interface StartLoginFlowResult {
  authUrl: string;
  mode: "browser-opened" | "mock";
}

interface AuthPollResult {
  status: "pending" | "success" | "error" | "idle";
  session?: AuthSession;
  message?: string;
}

export interface McpConnectionTestResult {
  ok: boolean;
  statusCode?: number;
  message: string;
}

const PI_STREAM_EVENT = "kiya://pi-stream";

const SESSION_STORE_KEY = "authSession";
const CONFIG_STORE_KEY = "localConfig";
const store = new LazyStore("kiya-agent.store.json", {
  defaults: {},
  autoSave: true,
});

function isTauriRuntime() {
  return isTauri();
}

async function saveSession(session: AuthSession) {
  if (isTauriRuntime()) {
    await store.set(SESSION_STORE_KEY, session);
    await store.save();
    return;
  }

  localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(session));
}

export async function saveConfig(config: LocalConfig): Promise<void> {
  if (isTauriRuntime()) {
    await store.set(CONFIG_STORE_KEY, config);
    await store.save();
    return;
  }

  localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(config));
}

export async function loadSession(): Promise<AuthSession | null> {
  if (isTauriRuntime()) {
    const session = await store.get<AuthSession>(SESSION_STORE_KEY);
    return session ?? null;
  }

  const rawSession = localStorage.getItem(SESSION_STORE_KEY);
  return rawSession ? (JSON.parse(rawSession) as AuthSession) : null;
}

export async function loadConfig(): Promise<Partial<LocalConfig> | null> {
  if (isTauriRuntime()) {
    const config = await store.get<Partial<LocalConfig>>(CONFIG_STORE_KEY);
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

  const parsed = JSON.parse(rawConfig) as Partial<LocalConfig>;
  return {
    ...parsed,
    remoteMcpServers: mergeRemoteMcpServers(parsed.remoteMcpServers),
  };
}

async function clearSession() {
  if (isTauriRuntime()) {
    await store.delete(SESSION_STORE_KEY);
    await store.save();
    return;
  }

  localStorage.removeItem(SESSION_STORE_KEY);
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
      "[bootstrap] auth callback ready",
    ],
  };
}

export async function readRuntimeDefaults(): Promise<RuntimeDefaults> {
  if (isTauriRuntime()) {
    return invoke<RuntimeDefaults>("read_runtime_defaults");
  }

  return previewRuntimeDefaults;
}

export async function startLoginFlow(config: LocalConfig): Promise<AuthSession> {
  if (!isTauriRuntime()) {
    const session = {
      accessToken: "mock_access_token",
      refreshToken: "mock_refresh_token",
      expiresAt: Date.now() + 1000 * 60 * 60,
      user: {
        id: "user_kiya",
        name: "Kiya User",
      },
    };

    await saveSession(session);
    return session;
  }

  await invoke<StartLoginFlowResult>("start_login_flow", {
    baseUrl: config.casdoorBaseUrl,
    clientId: config.casdoorClientId,
    scope: config.casdoorScope,
    redirectUri: config.casdoorRedirectUri,
  });

  const timeoutAt = Date.now() + 1000 * 60 * 3;
  while (Date.now() < timeoutAt) {
    const result = await invoke<AuthPollResult>("poll_auth_session");
    if (result.status === "success" && result.session) {
      await saveSession(result.session);
      return result.session;
    }

    if (result.status === "error") {
      throw new Error(result.message ?? "Casdoor 登录失败");
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error("登录超时，请确认 Casdoor 回调已完成");
}

export async function logoutSession(): Promise<void> {
  await clearSession();
  return;
}

export async function streamPiAgent(
  message: string,
  config: LocalConfig,
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

  await new Promise<void>(async (resolve, reject) => {
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
        config: launchConfig,
      });
    } catch (error) {
      await unlisten();
      reject(error);
    }
  });
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

export async function submitDownload(
  query: string,
  downloadDir = defaultConfig.downloadDir,
): Promise<DownloadTask> {
  const title = query.trim() || "未命名资源";

  if (isTauriRuntime()) {
    const result = await invoke<DownloadTask>("submit_download_request", {
      url: query,
      output: undefined,
    });
    return result;
  }

  return {
    id: crypto.randomUUID(),
    name: title,
    status: "downloading",
    progress: 24,
    speed: "8.4 MB/s",
    filePath: `${downloadDir}/${title}.mp4`,
    source: "远程 MCP",
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

export async function listDownloadTasks(): Promise<DownloadTask[]> {
  if (isTauriRuntime()) {
    return invoke<DownloadTask[]>("list_download_tasks");
  }

  return getInitialDownloads(defaultConfig.downloadDir);
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
    label: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    baseUrlPlaceholder: "可选，例如 https://api.openai.com/v1",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    baseUrlPlaceholder: "可选，留空则使用官方地址",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-4.1-mini",
    baseUrlPlaceholder: "可选，例如 https://openrouter.ai/api/v1",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    baseUrlPlaceholder: "可选，留空则使用官方地址",
  },
  {
    value: "custom-openai",
    label: "Custom OpenAI-Compatible",
    defaultModel: "gpt-4o-mini",
    baseUrlPlaceholder: "必填，例如 https://your-proxy.example.com/v1",
  },
];

export const remoteMcpTransportOptions: Array<{ value: RemoteMcpTransport; label: string }> = [
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "sse", label: "SSE" },
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
          enabled: saved.enabled,
          headers:
            hasLegacyCasdoorPlaceholder(saved.headers) || !saved.headers
              ? {}
              : saved.headers,
        }
      : server;
  });

  const customServers = persistedServers.filter(
    (server) => !embeddedRemoteMcpServers.some((item) => item.id === server.id),
  );

  return [...embeddedServers, ...customServers];
}

function hasLegacyCasdoorPlaceholder(headers?: Record<string, string>) {
  if (!headers) {
    return false;
  }

  return Object.values(headers).some((value) =>
    value.includes("{{casdoor_access_token}}"),
  );
}

export function createRemoteMcpServer(
  patch?: Partial<RemoteMcpServer>,
): RemoteMcpServer {
  return {
    id: patch?.id ?? crypto.randomUUID(),
    name: patch?.name ?? "New MCP",
    enabled: patch?.enabled ?? true,
    transport: patch?.transport ?? "streamable-http",
    url: patch?.url ?? "",
    headers: patch?.headers ?? {},
    isEmbedded: patch?.isEmbedded ?? false,
  };
}
