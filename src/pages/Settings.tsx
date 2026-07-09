import { useState } from "react";
import { Navigate } from "react-router-dom";

import { SectionBlock } from "@/components/section-block";
import {
  createRemoteMcpServer,
  modelProviderOptions,
  remoteMcpTransportOptions,
  testMcpServer,
} from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { ModelProvider, RemoteMcpServer } from "@/types/app";

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

export default function SettingsPage() {
  const session = useAppStore((state) => state.session);
  const config = useAppStore((state) => state.config);
  const logs = useAppStore((state) => state.logs);
  const updateConfig = useAppStore((state) => state.updateConfig);
  const logout = useAppStore((state) => state.logout);
  const openSource = usePlaylistStore((state) => state.openSource);
  const [testState, setTestState] = useState<
    Record<string, { loading: boolean; message?: string; ok?: boolean }>
  >({});
  const [playbackUrl, setPlaybackUrl] = useState(
    "https://www.w3schools.com/html/mov_bbb.mp4",
  );
  const [playbackTitle, setPlaybackTitle] = useState("Big Buck Bunny 示例视频");
  const [playbackMessage, setPlaybackMessage] = useState<string | null>(null);

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

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="h-full overflow-y-auto pr-2">
      <div className="space-y-12 pb-8">
      <SectionBlock title="Account">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              user
            </p>
            <p className="text-sm text-zinc-900 dark:text-zinc-100">
              {session.user.name}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              token
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {session.accessToken.slice(0, 10)}...
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-sm text-zinc-500 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          退出登录
        </button>
      </SectionBlock>

      <SectionBlock title="Downloads">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              download dir
            </span>
            <input
              value={config.downloadDir}
              onChange={(event) =>
                updateConfig({ downloadDir: event.target.value })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              aria2 rpc port
            </span>
            <input
              value={config.aria2RpcPort}
              onChange={(event) =>
                updateConfig({ aria2RpcPort: Number(event.target.value) || 0 })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
        </div>
      </SectionBlock>

      <SectionBlock title="Integrations">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              local mcp port
            </span>
            <input
              value={config.localMcpPort}
              onChange={(event) =>
                updateConfig({ localMcpPort: Number(event.target.value) || 0 })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              casdoor base url
            </span>
            <input
              value={config.casdoorBaseUrl}
              onChange={(event) =>
                updateConfig({ casdoorBaseUrl: event.target.value })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              casdoor client id
            </span>
            <input
              value={config.casdoorClientId}
              onChange={(event) =>
                updateConfig({ casdoorClientId: event.target.value })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              casdoor scope
            </span>
            <input
              value={config.casdoorScope}
              onChange={(event) =>
                updateConfig({ casdoorScope: event.target.value })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              redirect uri
            </span>
            <input
              value={config.casdoorRedirectUri}
              onChange={(event) =>
                updateConfig({ casdoorRedirectUri: event.target.value })
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
        </div>
      </SectionBlock>

      <SectionBlock title="Playback Test">
        <div className="space-y-5">
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            这里会绕过模型，直接把视频直链送进应用内播放器，专门用来验证
            `play_video` 的前端播放链路是否正常。
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                video url
              </span>
              <input
                value={playbackUrl}
                onChange={(event) => {
                  setPlaybackUrl(event.target.value);
                  setPlaybackMessage(null);
                }}
                placeholder="https://example.com/video.mp4"
                className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                title
              </span>
              <input
                value={playbackTitle}
                onChange={(event) => {
                  setPlaybackTitle(event.target.value);
                  setPlaybackMessage(null);
                }}
                placeholder="可选标题"
                className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
              />
            </label>
            <div className="flex items-end gap-3">
              <button
                type="button"
                onClick={() => {
                  const source = playbackUrl.trim();
                  if (!source) {
                    setPlaybackMessage("请先填写视频直链");
                    return;
                  }

                  openSource(source, {
                    title: playbackTitle.trim() || undefined,
                    origin: "manual",
                  });
                  setPlaybackMessage("已直接送入应用内播放器，并写入播放列表");
                }}
                className="inline-flex items-center rounded-full bg-zinc-950 px-4 py-2 text-sm text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
              >
                应用内播放
              </button>
            </div>
          </div>
          {playbackMessage ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {playbackMessage}
            </p>
          ) : null}
        </div>
      </SectionBlock>

      <SectionBlock title="MCP Servers">
        <div className="space-y-8">
          {config.remoteMcpServers.map((server) => (
            <div
              key={server.id}
              className="space-y-6 border-b border-black/[0.06] pb-6 dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-zinc-900 dark:text-zinc-100">
                  {server.name || "Untitled MCP"}
                </p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
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
                    enabled
                  </label>
                  <button
                    type="button"
                    disabled={server.isEmbedded}
                    onClick={() =>
                      updateConfig({
                        remoteMcpServers: config.remoteMcpServers.filter(
                          (item) => item.id !== server.id,
                        ),
                      })
                    }
                    className="text-xs uppercase tracking-[0.2em] text-zinc-400 transition hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-zinc-100"
                  >
                    remove
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
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
                            message:
                              error instanceof Error
                                ? error.message
                                : "MCP 测试失败",
                          },
                        }));
                      }
                    }}
                    className="text-xs uppercase tracking-[0.2em] text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {testState[server.id]?.loading ? "testing" : "test"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs">
                {server.isEmbedded ? (
                  <span className="rounded-full bg-black/[0.05] px-3 py-1 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-300">
                    系统默认
                  </span>
                ) : null}
                {server.isEmbedded ? (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    地址内置，token 需手动填写
                  </span>
                ) : null}
                {testState[server.id]?.message ? (
                  <span
                    className={
                      testState[server.id]?.ok
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {testState[server.id]?.message}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                    id
                  </span>
                  <input
                    value={server.id}
                    disabled={server.isEmbedded}
                    onChange={(event) =>
                      updateRemoteServer(server.id, (current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                    className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-100"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                    name
                  </span>
                  <input
                    value={server.name}
                    disabled={server.isEmbedded}
                    onChange={(event) =>
                      updateRemoteServer(server.id, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-100"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                    transport
                  </span>
                  <select
                    value={server.transport}
                    disabled={server.isEmbedded}
                    onChange={(event) =>
                      updateRemoteServer(server.id, (current) => ({
                        ...current,
                        transport: event.target.value as RemoteMcpServer["transport"],
                      }))
                    }
                    className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-100"
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
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                    url
                  </span>
                  <input
                    value={server.url}
                    disabled={server.isEmbedded}
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
                    className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-100"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                    headers json
                  </span>
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
                    placeholder={
                      server.isEmbedded
                        ? '{\n  "Authorization": "Bearer your_mcp_token"\n}'
                        : '{\n  "Authorization": "Bearer ..."\n}'
                    }
                    rows={5}
                    className="w-full resize-none border border-black/[0.06] bg-transparent px-0 py-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
                  />
                </label>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              updateConfig({
                remoteMcpServers: [
                  ...config.remoteMcpServers,
                  createRemoteMcpServer(),
                ],
              })
            }
            className="text-sm text-zinc-500 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            新增 MCP 服务
          </button>
        </div>
      </SectionBlock>

      <SectionBlock title="Model">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              provider
            </span>
            <select
              value={config.modelProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as ModelProvider;
                const preset = modelProviderOptions.find(
                  (option) => option.value === nextProvider,
                );
                updateConfig({
                  modelProvider: nextProvider,
                  modelName:
                    preset && !config.modelName.trim()
                      ? preset.defaultModel
                      : config.modelName,
                });
              }}
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
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
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              model
            </span>
            <input
              value={config.modelName}
              onChange={(event) =>
                updateConfig({ modelName: event.target.value })
              }
              placeholder={
                modelProviderOptions.find(
                  (option) => option.value === config.modelProvider,
                )?.defaultModel ?? ""
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              api key
            </span>
            <input
              type="password"
              value={config.modelApiKey}
              onChange={(event) =>
                updateConfig({ modelApiKey: event.target.value })
              }
              placeholder="sk-..."
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-xs uppercase tracking-[0.24em] text-zinc-400">
              base url
            </span>
            <input
              value={config.modelBaseUrl}
              onChange={(event) =>
                updateConfig({ modelBaseUrl: event.target.value })
              }
              placeholder={
                modelProviderOptions.find(
                  (option) => option.value === config.modelProvider,
                )?.baseUrlPlaceholder ?? ""
              }
              className="w-full border-b border-black/[0.08] bg-transparent pb-3 text-sm text-zinc-900 outline-none dark:border-white/10 dark:text-zinc-100"
            />
          </label>
        </div>
      </SectionBlock>

      <SectionBlock title="Diagnostics">
        <div className="space-y-3">
          {logs.map((log, index) => (
            <p
              key={`${index}-${log}`}
              className="font-mono text-xs leading-6 text-zinc-500 dark:text-zinc-400"
            >
              {log}
            </p>
          ))}
        </div>
      </SectionBlock>
      </div>
    </div>
  );
}
