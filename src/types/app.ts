export type ServiceState = "starting" | "ready" | "error";

export interface AppBootstrapStatus {
  aria2: ServiceState;
  localMcp: ServiceState;
  piAgentConfig: "missing" | "generated" | "error";
}

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "deepseek"
  | "custom-openai";

export type RemoteMcpTransport = "streamable-http" | "sse";

export interface RemoteMcpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport: RemoteMcpTransport;
  url: string;
  headers: Record<string, string>;
  isEmbedded?: boolean;
}

export interface LocalConfig {
  downloadDir: string;
  remoteMcpServers: RemoteMcpServer[];
  localMcpPort: number;
  aria2RpcPort: number;
  modelProvider: ModelProvider;
  modelName: string;
  modelApiKey: string;
  modelBaseUrl: string;
}

export interface RuntimeDefaults {
  downloadDir: string;
  runtimeTarget: string;
}

export interface DownloadTask {
  id: string;
  name: string;
  status: "queued" | "downloading" | "completed" | "failed";
  progress: number;
  speed: string;
  filePath: string;
  source: string;
  downloadUrl?: string;
  aria2Gid?: string;
}

export interface PlaylistItem {
  id: string;
  title: string;
  source: string;
  kind: "local-file" | "remote-url";
  origin: "tool-call" | "manual" | "download";
  addedAt: string;
}

export interface ToolCallSummary {
  tool: string;
  detail: string;
}

export interface PiPromptResult {
  assistantText: string;
  toolCalls: ToolCallSummary[];
  logs: string[];
}

export interface PiStreamEvent {
  requestId: string;
  stage: "start" | "text-delta" | "tool-call" | "error" | "complete";
  delta?: string;
  assistantText?: string;
  toolCall?: ToolCallSummary;
  message?: string;
  logs?: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  toolCall?: ToolCallSummary;
  streaming?: boolean;
}
