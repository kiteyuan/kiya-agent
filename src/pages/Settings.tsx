import { useState } from "react";
import { Check, FolderOpen } from "lucide-react";

import { SectionBlock } from "@/components/section-block";
import {
  modelNameOptionsByProvider,
  modelProviderOptions,
  normalizeDesktopError,
  openExternalUrl,
  remoteMcpTransportOptions,
  selectDownloadDirectory,
  testModelConnection,
  testMcpServer,
} from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import type { LocalConfig, ModelProvider, RemoteMcpServer } from "@/types/app";

const fieldLabelClassName = "text-xs font-medium text-zinc-500 dark:text-zinc-400";
const inputClassName =
  "w-full rounded-2xl border border-black/[0.08] bg-transparent px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-950 dark:border-white/10 dark:text-zinc-100 dark:focus:border-zinc-100";
const subtleButtonClassName =
  "inline-flex items-center rounded-full px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-black/[0.04] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-100";
const inputButtonClassName =
  "inline-flex h-[50px] shrink-0 items-center rounded-2xl border border-black/[0.08] bg-transparent px-4 text-sm text-zinc-600 transition hover:border-black/[0.14] hover:text-zinc-950 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20 dark:hover:text-zinc-100";

function headersToText(headers: Record<string, string>) {
  if (Object.keys(headers).length === 0) {
    return "";
  }
  return JSON.stringify(headers, null, 2);
}

function parseHeaders(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("headers 必须是 JSON 对象");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function getMcpToken(headers: Record<string, string>) {
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

function updateMcpTokenHeaders(
  headers: Record<string, string>,
  token: string,
): Record<string, string> {
  const trimmedToken = token.trim();
  const nextHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"),
  );

  if (!trimmedToken) {
    return nextHeaders;
  }

  return {
    ...nextHeaders,
    Authorization: `Bearer ${trimmedToken}`,
  };
}

function canTestServer(server: RemoteMcpServer) {
  if (server.isEmbedded) {
    return Boolean(getMcpToken(server.headers).trim());
  }

  return Boolean(server.url.trim());
}

function getEmbeddedMcpTokenUrl(serverId: string) {
  if (serverId === "magnet") {
    return "https://magnet.kiteyuan.info/mcp";
  }

  if (serverId === "magnetflow") {
    return "https://mybt.kiteyuan.info/mcp-docs";
  }

  return null;
}

function getEmbeddedMcpTokenLabel(server: RemoteMcpServer) {
  if (server.id === "magnet") {
    return "纸鸢搜索 MCP Token";
  }

  if (server.id === "magnetflow") {
    return "纸鸢下载 MCP Token";
  }

  return `${server.name || "未命名 MCP"} MCP Token`;
}

function getModelOptions(provider: ModelProvider) {
  return modelNameOptionsByProvider[provider] ?? [];
}

function canTestModel(config: LocalConfig) {
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

export default function SettingsPage() {
  const config = useAppStore((state) => state.config);
  const updateConfig = useAppStore((state) => state.updateConfig);
  const configDirty = useAppStore((state) => state.configDirty);
  const configSaving = useAppStore((state) => state.configSaving);
  const persistConfig = useAppStore((state) => state.persistConfig);
  const [isPickingDownloadDir, setIsPickingDownloadDir] = useState(false);
  const [testState, setTestState] = useState<
    Record<string, { loading: boolean; message?: string; ok?: boolean }>
  >({});
  const modelTestStateKey = "model-connection";

  const updateRemoteServer = (
    serverId: string,
    updater: (server: RemoteMcpServer) => RemoteMcpServer,
  ) => {
    updateConfig({
      remoteMcpServers: config.remoteMcpServers.map((server) =>
        server.id === serverId ? updater(server) : server,
      ),
    });
  };

  const handleTestServer = async (server: RemoteMcpServer) => {
    setTestState((state) => ({
      ...state,
      [server.id]: { loading: true },
    }));

    try {
      const result = await testMcpServer(server);
      setTestState((state) => ({
        ...state,
        [server.id]: {
          loading: false,
          ok: result.ok,
          message: result.message,
        },
      }));
    } catch (error) {
      setTestState((state) => ({
        ...state,
        [server.id]: {
          loading: false,
          ok: false,
          message: normalizeDesktopError(error, "MCP 连接测试失败"),
        },
      }));
    }
  };

  const clearModelTestState = () => {
    setTestState((state) => {
      if (!state[modelTestStateKey]) {
        return state;
      }

      const nextState = { ...state };
      delete nextState[modelTestStateKey];
      return nextState;
    });
  };

  const handleTestModel = async () => {
    setTestState((state) => ({
      ...state,
      [modelTestStateKey]: { loading: true },
    }));

    try {
      const result = await testModelConnection(config);
      setTestState((state) => ({
        ...state,
        [modelTestStateKey]: {
          loading: false,
          ok: result.ok,
          message: result.message,
        },
      }));
    } catch (error) {
      setTestState((state) => ({
        ...state,
        [modelTestStateKey]: {
          loading: false,
          ok: false,
          message: normalizeDesktopError(error, "模型连接测试失败"),
        },
      }));
    }
  };

  const modelOptions = getModelOptions(config.modelProvider);
  const hasPresetModel = modelOptions.some((option) => option.value === config.modelName);
  const isCustomModelInputVisible =
    config.modelProvider === "custom-openai" ||
    (config.modelName.trim().length > 0 && !hasPresetModel);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[920px] space-y-5 pb-7">
      <SectionBlock
        title="下载设置"
      >
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className={fieldLabelClassName}>下载目录</span>
            <div className="flex items-center gap-3">
              <input
                value={config.downloadDir}
                onChange={(event) =>
                  updateConfig({ downloadDir: event.target.value })
                }
                className={`${inputClassName} flex-1`}
              />
              <button
                type="button"
                disabled={isPickingDownloadDir}
                onClick={async () => {
                  setIsPickingDownloadDir(true);
                  try {
                    const selectedPath = await selectDownloadDirectory(config.downloadDir);
                    if (selectedPath) {
                      updateConfig({ downloadDir: selectedPath });
                    }
                  } finally {
                    setIsPickingDownloadDir(false);
                  }
                }}
                className="inline-flex h-[50px] shrink-0 items-center gap-2 rounded-2xl border border-black/[0.08] px-4 text-sm text-zinc-600 transition hover:border-black/[0.14] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20 dark:hover:text-zinc-100"
              >
                <FolderOpen className="h-4 w-4" />
                {isPickingDownloadDir ? "选择中" : "浏览"}
              </button>
            </div>
          </label>
        </div>
      </SectionBlock>

      <SectionBlock
        title="MCP 服务"
      >
        <div className="space-y-5">
          {config.remoteMcpServers.map((server) => (
            <div
              key={server.id}
              className="space-y-2.5 pb-2"
            >
              {server.isEmbedded ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div
                      className={`flex items-center gap-2 text-sm ${
                        testState[server.id]?.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
                      {testState[server.id]?.ok ? (
                        <Check className="h-4 w-4 shrink-0" />
                      ) : null}
                      <span>{getEmbeddedMcpTokenLabel(server)}</span>
                    </div>
                    {getEmbeddedMcpTokenUrl(server.id) ? (
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl(getEmbeddedMcpTokenUrl(server.id) ?? "")
                        }
                        className={`${subtleButtonClassName} shrink-0`}
                      >
                        点我获取MCP Token
                      </button>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <input
                      type="password"
                      value={getMcpToken(server.headers)}
                      onChange={(event) =>
                        updateRemoteServer(server.id, (current) => ({
                          ...current,
                          headers: updateMcpTokenHeaders(current.headers, event.target.value),
                        }))
                      }
                      placeholder="输入 MCP Token"
                      className={`${inputClassName} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      disabled={!canTestServer(server) || testState[server.id]?.loading}
                      onClick={() => void handleTestServer(server)}
                      className={`${inputButtonClassName} justify-center disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {testState[server.id]?.loading ? "测试中" : "测试连接"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">
                      {server.name || "未命名 MCP"}
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(event) =>
                            updateRemoteServer(server.id, (current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        已启用
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateConfig({
                            remoteMcpServers: config.remoteMcpServers.filter(
                              (item) => item.id !== server.id,
                            ),
                          })
                        }
                        className={subtleButtonClassName}
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        disabled={!canTestServer(server) || testState[server.id]?.loading}
                        onClick={() => void handleTestServer(server)}
                        className={subtleButtonClassName}
                      >
                        {testState[server.id]?.loading ? "测试中" : "测试连接"}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className={fieldLabelClassName}>标识</span>
                      <input
                        value={server.id}
                        onChange={(event) =>
                          updateRemoteServer(server.id, (current) => ({
                            ...current,
                            id: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="space-y-2">
                      <span className={fieldLabelClassName}>名称</span>
                      <input
                        value={server.name}
                        onChange={(event) =>
                          updateRemoteServer(server.id, (current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="space-y-2">
                      <span className={fieldLabelClassName}>传输方式</span>
                      <select
                        value={server.transport}
                        onChange={(event) =>
                          updateRemoteServer(server.id, (current) => ({
                            ...current,
                            transport: event.target.value as RemoteMcpServer["transport"],
                          }))
                        }
                        className={inputClassName}
                      >
                        {remoteMcpTransportOptions.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className={fieldLabelClassName}>地址</span>
                      <input
                        value={server.url}
                        onChange={(event) =>
                          updateRemoteServer(server.id, (current) => ({
                            ...current,
                            url: event.target.value,
                          }))
                        }
                        placeholder={
                          server.transport === "sse"
                            ? "https://example.com/mcp/sse"
                            : "https://example.com/mcp/stream"
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="space-y-2 md:col-span-2">
                      <span className={fieldLabelClassName}>请求头 JSON</span>
                      <textarea
                        key={`${server.id}-${headersToText(server.headers)}`}
                        defaultValue={headersToText(server.headers)}
                        onBlur={(event) => {
                          try {
                            const headers = parseHeaders(event.target.value);
                            updateRemoteServer(server.id, (current) => ({
                              ...current,
                              headers,
                            }));
                          } catch {
                            return;
                          }
                        }}
                        placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                        rows={5}
                        className={`${inputClassName} min-h-[120px] resize-none`}
                      />
                    </label>
                  </div>
                </>
              )}

              {testState[server.id]?.message && !testState[server.id]?.ok ? (
                <p
                  className={`text-xs ${
                    testState[server.id]?.ok
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {testState[server.id]?.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock title="LLM模型">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className={fieldLabelClassName}>
              提供方
            </span>
            <select
              value={config.modelProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as ModelProvider;
                const preset = modelProviderOptions.find(
                  (option) => option.value === nextProvider,
                );
                clearModelTestState();
                updateConfig({
                  modelProvider: nextProvider,
                  modelName: preset?.defaultModel ?? "",
                });
              }}
              className={inputClassName}
            >
              {modelProviderOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className={fieldLabelClassName}>
              模型名称
            </span>
            <div className="space-y-2">
              {config.modelProvider === "custom-openai" ? null : (
                <select
                  value={hasPresetModel ? config.modelName : "__custom__"}
                  onChange={(event) => {
                    if (event.target.value === "__custom__") {
                      clearModelTestState();
                      updateConfig({ modelName: "" });
                      return;
                    }

                    clearModelTestState();
                    updateConfig({ modelName: event.target.value });
                  }}
                  className={inputClassName}
                >
                  {modelOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {option.label}
                    </option>
                  ))}
                  <option
                    value="__custom__"
                    className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    手动输入其他模型
                  </option>
                </select>
              )}

              {isCustomModelInputVisible ? (
                <input
                  value={config.modelName}
                  onChange={(event) => {
                    clearModelTestState();
                    updateConfig({ modelName: event.target.value })
                  }}
                  placeholder={
                    modelProviderOptions.find(
                      (option) => option.value === config.modelProvider,
                    )?.defaultModel ?? ""
                  }
                  className={inputClassName}
                />
              ) : null}
            </div>
          </label>

          <label className="space-y-2 md:col-span-2">
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-2 text-xs font-medium ${
                  testState[modelTestStateKey]?.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {testState[modelTestStateKey]?.ok ? (
                  <Check className="h-4 w-4 shrink-0" />
                ) : null}
                <span>API 密钥</span>
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <input
                type="password"
                value={config.modelApiKey}
                onChange={(event) => {
                  clearModelTestState();
                  updateConfig({ modelApiKey: event.target.value });
                }}
                placeholder="sk-..."
                className={`${inputClassName} min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={!canTestModel(config) || testState[modelTestStateKey]?.loading}
                onClick={() => void handleTestModel()}
                className={`${inputButtonClassName} justify-center disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {testState[modelTestStateKey]?.loading ? "测试中" : "测试连接"}
              </button>
            </div>
          </label>

          {config.modelProvider === "custom-openai" ? (
            <label className="space-y-2 md:col-span-2">
              <span className={fieldLabelClassName}>
                接口地址
              </span>
              <input
                value={config.modelBaseUrl}
                onChange={(event) => {
                  clearModelTestState();
                  updateConfig({ modelBaseUrl: event.target.value })
                }}
                placeholder={
                  modelProviderOptions.find(
                    (option) => option.value === config.modelProvider,
                  )?.baseUrlPlaceholder ?? ""
                }
                className={inputClassName}
              />
            </label>
          ) : null}

          {testState[modelTestStateKey]?.message && !testState[modelTestStateKey]?.ok ? (
            <p className="text-xs text-amber-600 dark:text-amber-400 md:col-span-2">
              {testState[modelTestStateKey]?.message}
            </p>
          ) : null}
        </div>
      </SectionBlock>

      <div className="sticky bottom-0 flex justify-end pt-2">
        <button
          type="button"
          disabled={!configDirty || configSaving}
          onClick={() => void persistConfig()}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-zinc-950 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-white/90 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300"
        >
          保存设置
        </button>
      </div>
      </div>
    </div>
  );
}
