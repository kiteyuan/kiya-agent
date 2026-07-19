import type {
  AppBootstrapStatus,
  LocalConfig,
  ModelProvider,
  RemoteMcpServer,
  RemoteMcpTransport,
} from "@/types/app";

import { previewRuntimeDefaults } from "./runtime";

export const embeddedRemoteMcpServers: RemoteMcpServer[] = [
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

export const defaultConfig: LocalConfig = {
  language: "zh-CN",
  downloadDir: previewRuntimeDefaults.downloadDir,
  remoteMcpServers: embeddedRemoteMcpServers,
  localMcpPort: 17321,
  aria2RpcPort: 16800,
  modelProvider: "deepseek",
  modelName: "deepseek-v4-flash",
  modelApiKey: "",
  modelBaseUrl: "",
  autoApproveTools: true,
};

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

export const modelNameOptionsByProvider: Partial<
  Record<
    ModelProvider,
    Array<{
      value: string;
      label: string;
    }>
  >
> = {
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
    {
      value: "deepseek-reasoner",
      label: "deepseek-reasoner（兼容别名，即将退场）",
    },
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5" },
    { value: "anthropic/claude-opus-4-8", label: "Anthropic: Claude Opus 4.8" },
    { value: "openai/gpt-5.5", label: "OpenAI: GPT-5.5" },
    { value: "deepseek/deepseek-v4-flash", label: "DeepSeek: V4 Flash" },
    { value: "openrouter/fusion", label: "OpenRouter: Fusion" },
    { value: "openrouter/owl-alpha", label: "OpenRouter: Owl Alpha" },
    {
      value: "openrouter/pareto-code",
      label: "OpenRouter: Pareto Code Router",
    },
  ],
};

export const remoteMcpTransportOptions: Array<{
  value: RemoteMcpTransport;
  label: string;
}> = [
  { value: "streamable-http", label: "流式 HTTP" },
  { value: "sse", label: "SSE 长连接" },
];

export function mergeRemoteMcpServers(
  savedServers?: RemoteMcpServer[],
): RemoteMcpServer[] {
  const persistedServers = savedServers ?? [];
  const persistedMap = new Map(
    persistedServers.map((server) => [server.id, server]),
  );

  const embeddedServers = embeddedRemoteMcpServers.map((server) => {
    const saved = persistedMap.get(server.id);
    return saved
      ? {
          ...server,
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

export function buildPiLaunchConfig(config: LocalConfig) {
  return {
    ...config,
    remoteMcpServers: mergeRemoteMcpServers(config.remoteMcpServers),
  };
}
