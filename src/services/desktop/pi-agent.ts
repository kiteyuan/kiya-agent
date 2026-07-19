import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  ChatMessage,
  LocalConfig,
  PiStreamEvent,
  RemoteMcpServer,
} from "@/types/app";

import { buildPiLaunchConfig } from "./defaults";
import { isTauriRuntime } from "./runtime";

export interface McpConnectionTestResult {
  ok: boolean;
  statusCode?: number;
  message: string;
}

const PI_STREAM_EVENT = "kiya://pi-stream";
const PROMPT_HISTORY_LIMIT = 16;

export function normalizeDesktopError(
  error: unknown,
  fallback: string,
): string {
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
        const detail =
          message.toolCall?.detail?.trim() || message.content.trim();
        return `[tool] ${toolName}: ${detail}`;
      }

      const roleLabel = message.role === "user" ? "user" : "assistant";
      return `[${roleLabel}] ${message.content.trim()}`;
    })
    .join("\n\n");
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

export async function testMcpServer(
  server: RemoteMcpServer,
): Promise<McpConnectionTestResult> {
  if (!isTauriRuntime()) {
    return {
      ok: true,
      statusCode: 200,
      message: "预览模式跳过真实 MCP 探测",
    };
  }

  return invoke<McpConnectionTestResult>("test_mcp_server", {
    url: server.url,
    headers: server.headers,
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
