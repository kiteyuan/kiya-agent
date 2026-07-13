import {
  Activity,
  Download,
  Github,
  ListVideo,
  PenSquare,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { PlayerOverlay } from "@/components/player-overlay";
import { ImageGalleryOverlay } from "@/components/image-gallery-overlay";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";
import { useDownloadStore } from "@/stores/download-store";
import { usePlaylistStore } from "@/stores/playlist-store";

const navItems = [
  {
    to: "/app/downloads",
    label: "下载记录",
    icon: Download,
  },
  {
    to: "/app/playlist",
    label: "播放历史",
    icon: ListVideo,
  },
  {
    to: "/app/settings",
    label: "设置",
    icon: Settings2,
  },
  {
    to: "/app/diagnostics",
    label: "诊断日志",
    icon: Activity,
  },
];

export function AppShell() {
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const status = useAppStore((state) => state.status);
  const config = useAppStore((state) => state.config);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const createConversation = useChatStore((state) => state.createConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const isSending = useChatStore((state) => state.isSending);
  const downloadUnreadCount = useDownloadStore((state) => state.unreadCount);
  const playlistUnreadCount = usePlaylistStore((state) => state.unreadCount);
  const markDownloadsSeen = useDownloadStore((state) => state.markAllSeen);
  const markPlaylistSeen = usePlaylistStore((state) => state.markAllSeen);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isChatRoute = location.pathname.startsWith("/app/chat");
  const isDownloadsRoute = location.pathname.startsWith("/app/downloads");
  const isPlaylistRoute = location.pathname.startsWith("/app/playlist");
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentConversationId,
  );
  const isNewChatActive =
    isChatRoute && (!currentConversation || currentConversation.messageCount === 0);
  const visibleConversations = conversations.filter(
    (conversation) => conversation.messageCount > 0,
  );
  const pendingDeleteConversation = conversations.find(
    (conversation) => conversation.id === pendingDeleteConversationId,
  );
  const magnetSearchMcpState = resolveRemoteMcpState(
    bootstrapped,
    config.remoteMcpServers,
    "magnet",
  );
  const magnetDownloadMcpState = resolveRemoteMcpState(
    bootstrapped,
    config.remoteMcpServers,
    "magnetflow",
  );
  const llmModelState = resolveLlmModelState(bootstrapped, config);

  useEffect(() => {
    if (isDownloadsRoute) {
      markDownloadsSeen();
    }
  }, [isDownloadsRoute, markDownloadsSeen]);

  useEffect(() => {
    if (isPlaylistRoute) {
      markPlaylistSeen();
    }
  }, [isPlaylistRoute, markPlaylistSeen]);

  function formatUnreadCount(count: number) {
    if (count <= 0) {
      return null;
    }

    return count > 99 ? "99+" : String(count);
  }

  async function handleConfirmDeleteConversation() {
    if (!pendingDeleteConversationId || isDeletingConversation) {
      return;
    }

    setIsDeletingConversation(true);
    try {
      await deleteConversation(pendingDeleteConversationId);
      setPendingDeleteConversationId(null);
    } finally {
      setIsDeletingConversation(false);
    }
  }

  return (
    <div className="h-screen bg-[var(--app-bg)] text-zinc-950 dark:text-zinc-50">
      <div className="flex h-full w-full overflow-hidden">
        <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-black/[0.06] bg-white/60 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/70">
          <div className="flex items-center gap-3 px-2.5 py-1.5">
            <button
              type="button"
              onClick={() => void openExternalUrl("https://github.com/kiteyuan/kiya-agent")}
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
              aria-label="打开 Kiya Agent GitHub 仓库"
            >
              <Github className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Kiya Agent
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Pi Agent Desktop Workspace
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-1.5 px-1">
            <button
              type="button"
              onClick={() => {
                void createConversation().then(() => {
                  navigate("/app/chat");
                });
              }}
              disabled={isSending}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left text-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
                isNewChatActive
                  ? "bg-black/[0.06] text-zinc-950 dark:bg-white/[0.08] dark:text-zinc-100"
                  : "text-zinc-500 hover:bg-black/[0.04] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100",
              )}
            >
              <PenSquare
                className={cn(
                  "h-4 w-4 shrink-0",
                  isNewChatActive
                    ? "text-zinc-700 dark:text-zinc-200"
                    : "text-zinc-400 dark:text-zinc-500",
                )}
              />
              <span className="truncate">新聊天</span>
            </button>

            <nav className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const unreadCount =
                item.to === "/app/downloads"
                  ? downloadUnreadCount
                  : item.to === "/app/playlist"
                    ? playlistUnreadCount
                    : 0;
              const unreadLabel = formatUnreadCount(unreadCount);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-start gap-3 rounded-2xl px-2 py-2 text-sm transition-colors duration-200",
                      isActive
                        ? "bg-black/[0.06] text-zinc-950 dark:bg-white/[0.08] dark:text-zinc-100"
                        : "text-zinc-500 hover:bg-black/[0.04] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          isActive
                            ? "text-zinc-700 dark:text-zinc-200"
                            : "text-zinc-400 dark:text-zinc-500",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate">{item.label}</p>
                      </div>
                      {unreadLabel ? (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-950 px-1.5 text-[11px] font-medium leading-none text-white dark:bg-zinc-100 dark:text-zinc-950">
                          {unreadLabel}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              );
            })}
            </nav>
          </div>

          <div className="mt-4 min-h-0 flex-1 px-1">
            <div className="flex h-full min-h-0 flex-col">
              <div className="px-2 pb-1.5 pt-1">
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
                  最近
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-0.5">
                  {visibleConversations.map((conversation) => {
                    const isActive = conversation.id === currentConversationId;

                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-2xl px-1 py-0.5 transition",
                          isActive
                            ? "bg-black/[0.06] text-zinc-950 dark:bg-white/[0.08] dark:text-zinc-100"
                            : "text-zinc-600 hover:bg-black/[0.04] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100",
                          isSending && "opacity-60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/app/chat");
                            void selectConversation(conversation.id);
                          }}
                          disabled={isSending}
                          className="min-w-0 flex-1 rounded-[14px] px-1 py-1.5 text-left text-sm disabled:cursor-not-allowed"
                        >
                          <span
                            className={cn(
                              "block truncate",
                              isActive && "font-medium",
                            )}
                          >
                            {conversation.title || "新会话"}
                          </span>
                        </button>
                        {!isActive ? (
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteConversationId(conversation.id);
                            }}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 opacity-0 transition hover:bg-black/[0.05] hover:text-zinc-950 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
                            aria-label={`删除会话 ${conversation.title || "新会话"}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-black/[0.06] px-3 pt-3 dark:border-white/10">
            <div className="space-y-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <SidebarServiceState label="纸鸢搜索 MCP" state={magnetSearchMcpState} />
              <SidebarServiceState label="纸鸢下载 MCP" state={magnetDownloadMcpState} />
              <SidebarServiceState label="LLM 模型" state={llmModelState} />
            </div>
          </div>

        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      {pendingDeleteConversation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm dark:bg-black/40">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-zinc-950 shadow-[0_12px_40px_rgba(0,0,0,0.12)] dark:bg-zinc-900 dark:text-zinc-100">
            <div className="space-y-2">
              <p className="text-sm font-medium">删除这条对话？</p>
              <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                {pendingDeleteConversation.title || "新会话"}
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingConversation}
                onClick={() => setPendingDeleteConversationId(null)}
                className="inline-flex h-10 items-center justify-center rounded-2xl px-4 text-sm text-zinc-500 transition hover:bg-black/[0.04] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeletingConversation}
                onClick={() => void handleConfirmDeleteConversation()}
                className="inline-flex h-10 items-center justify-center rounded-2xl bg-zinc-950 px-4 text-sm text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ImageGalleryOverlay />
      <PlayerOverlay />
    </div>
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

function resolveRemoteMcpState(
  bootstrapped: boolean,
  remoteMcpServers: Array<{
    id?: string;
    enabled: boolean;
    isEmbedded?: boolean;
    url: string;
    headers: Record<string, string>;
  }>,
  serverId: string,
) {
  if (!bootstrapped) {
    return "starting" as const;
  }

  const targetServer = remoteMcpServers.find((server) => server.id === serverId);
  if (!targetServer) {
    return "error" as const;
  }

  if (targetServer.isEmbedded) {
    return getMcpToken(targetServer.headers).trim() ? ("ready" as const) : ("error" as const);
  }

  const isConfigured = targetServer.enabled && Boolean(targetServer.url.trim());
  return isConfigured ? ("ready" as const) : ("error" as const);
}

function resolveLlmModelState(
  bootstrapped: boolean,
  config: {
    modelProvider: string;
    modelApiKey: string;
    modelBaseUrl: string;
  },
) {
  if (!bootstrapped) {
    return "starting" as const;
  }

  if (!config.modelApiKey.trim()) {
    return "error" as const;
  }

  if (
    config.modelProvider === "custom-openai" &&
    !config.modelBaseUrl.trim()
  ) {
    return "error" as const;
  }

  return "ready" as const;
}

function SidebarServiceState({
  label,
  state,
}: {
  label: string;
  state: "starting" | "ready" | "error";
}) {
  const dotClassName =
    state === "ready"
      ? "bg-emerald-500"
      : state === "error"
        ? "bg-amber-500"
        : "bg-zinc-400 dark:bg-zinc-500";
  const statusLabel =
    state === "ready" ? "已连接" : state === "error" ? "未连接" : "连接中";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)} />
        <span className="truncate">{label}</span>
      </div>
      <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{statusLabel}</span>
    </div>
  );
}
