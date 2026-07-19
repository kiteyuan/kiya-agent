import type {
  AppLanguage,
  LocalConfig,
  ModelProvider,
  RemoteMcpServer,
} from "@/types/app";
import { modelNameOptionsByProvider } from "@/services/desktop";

export const fieldLabelClassName =
  "text-xs font-medium text-zinc-500 dark:text-zinc-400";
export const inputClassName =
  "w-full rounded-2xl border border-black/[0.08] bg-transparent px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-950 dark:border-white/10 dark:text-zinc-100 dark:focus:border-zinc-100";
export const subtleButtonClassName =
  "inline-flex items-center rounded-full px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-black/[0.04] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-100";
export const inputButtonClassName =
  "inline-flex h-[50px] shrink-0 items-center rounded-2xl border border-black/[0.08] bg-transparent px-4 text-sm text-zinc-600 transition hover:border-black/[0.14] hover:text-zinc-950 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20 dark:hover:text-zinc-100";

export function headersToText(headers: Record<string, string>) {
  if (Object.keys(headers).length === 0) {
    return "";
  }
  return JSON.stringify(headers, null, 2);
}

export function parseHeaders(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

export function getMcpToken(headers: Record<string, string>) {
  const authorizationEntry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "authorization",
  );

  if (!authorizationEntry) {
    return "";
  }

  const [, rawValue] = authorizationEntry;
  const matched = rawValue.match(/^Bearer\s+(.+)$/i);
  return matched ? matched[1] : rawValue;
}

export function updateMcpTokenHeaders(
  headers: Record<string, string>,
  token: string,
): Record<string, string> {
  const trimmedToken = token.trim();
  const nextHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => key.toLowerCase() !== "authorization",
    ),
  );

  if (!trimmedToken) {
    return nextHeaders;
  }

  return {
    ...nextHeaders,
    Authorization: `Bearer ${trimmedToken}`,
  };
}

export function canTestServer(server: RemoteMcpServer) {
  if (server.isEmbedded) {
    return Boolean(getMcpToken(server.headers).trim());
  }

  return Boolean(server.url.trim());
}

export function getEmbeddedMcpTokenUrl(serverId: string) {
  if (serverId === "magnet") {
    return "https://magnet.kiteyuan.info/mcp";
  }

  if (serverId === "magnetflow") {
    return "https://mybt.kiteyuan.info/mcp-docs";
  }

  return null;
}

export function getEmbeddedMcpTokenLabel(
  server: RemoteMcpServer,
  language: AppLanguage,
) {
  if (server.id === "magnet") {
    return language === "en"
      ? "Magnet Search MCP Token"
      : "纸鸢搜索 MCP Token";
  }

  if (server.id === "magnetflow") {
    return language === "en"
      ? "Magnet Download MCP Token"
      : "纸鸢下载 MCP Token";
  }

  return `${server.name || (language === "en" ? "Unnamed" : "未命名")} MCP Token`;
}

export function getModelOptions(provider: ModelProvider) {
  return modelNameOptionsByProvider[provider] ?? [];
}

export function canTestModel(config: LocalConfig) {
  if (!config.modelName.trim()) {
    return false;
  }

  if (!config.modelApiKey.trim()) {
    return false;
  }

  if (config.modelProvider === "custom-openai" && !config.modelBaseUrl.trim()) {
    return false;
  }

  return true;
}
