import {
  Bot,
  Download,
  ListVideo,
  MessageSquareText,
  Settings2,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { PlayerOverlay } from "@/components/player-overlay";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const navItems = [
  {
    to: "/app/chat",
    label: "聊天",
    icon: MessageSquareText,
  },
  {
    to: "/app/downloads",
    label: "下载",
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
];

const pageMeta = {
  "/app/chat": {
    eyebrow: "Workspace",
    title: "聊天",
  },
  "/app/downloads": {
    eyebrow: "Transfers",
    title: "下载",
  },
  "/app/playlist": {
    eyebrow: "Playback",
    title: "播放历史",
  },
  "/app/settings": {
    eyebrow: "Configuration",
    title: "设置",
  },
} as const;

export function AppShell() {
  const status = useAppStore((state) => state.status);
  const location = useLocation();
  const currentMeta =
    pageMeta[location.pathname as keyof typeof pageMeta] ?? pageMeta["/app/chat"];

  return (
    <div className="h-screen bg-[var(--app-bg)] text-zinc-950 dark:text-zinc-50">
      <div className="flex h-full w-full overflow-hidden">
        <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-black/[0.06] bg-white/60 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/70">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Kiya Agent
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Pi Agent Desktop Workspace
              </p>
            </div>
          </div>

          <nav className="mt-6 flex-1 space-y-1 overflow-y-auto px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm transition-colors duration-200",
                      isActive
                        ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
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
                            ? "text-white dark:text-zinc-950"
                            : "text-zinc-400 dark:text-zinc-500",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate">{item.label}</p>
                      </div>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="space-y-4 border-t border-black/[0.06] px-2 pt-4 dark:border-white/10">
            <div className="space-y-3 rounded-3xl bg-black/[0.03] p-4 dark:bg-white/[0.03]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
                Services
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusPill label="aria2" state={status.aria2} />
                <StatusPill label="local mcp" state={status.localMcp} />
                <StatusPill label="pi config" state={status.piAgentConfig} />
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-6 border-b border-black/[0.06] px-8 py-6 dark:border-white/10">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                {currentMeta.eyebrow}
              </p>
              <h1 className="text-2xl font-medium tracking-tight text-zinc-900 dark:text-zinc-50">
                {currentMeta.title}
              </h1>
            </div>

            <div className="hidden flex-wrap justify-end gap-3 xl:flex">
              <StatusPill label="aria2" state={status.aria2} />
              <StatusPill label="local mcp" state={status.localMcp} />
              <StatusPill label="pi config" state={status.piAgentConfig} />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      <PlayerOverlay />
    </div>
  );
}
