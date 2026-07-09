import { ArrowRight } from "lucide-react";
import { Navigate } from "react-router-dom";

import { StatusPill } from "@/components/status-pill";
import { useAppStore } from "@/stores/app-store";

export default function LoginPage() {
  const session = useAppStore((state) => state.session);
  const status = useAppStore((state) => state.status);
  const authError = useAppStore((state) => state.authError);
  const login = useAppStore((state) => state.login);

  if (session) {
    return <Navigate to="/app/chat" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-6 py-10">
      <div className="w-full max-w-2xl space-y-12">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">
            Kiya Agent
          </p>
          <h1 className="max-w-xl text-4xl font-medium leading-tight tracking-tight text-zinc-950 dark:text-zinc-50">
            从登录开始，把远程搜索、本地下载和播放器接成一条极简链路。
          </h1>
          <p className="max-w-xl text-sm leading-7 text-zinc-500 dark:text-zinc-400">
            当前阶段保留官方 Pi Agent，只补桌面壳、本地 MCP、Casdoor
            登录和下载播放闭环。
          </p>
        </div>

        <div className="space-y-6 border-t border-black/[0.08] pt-8 dark:border-white/10">
          <button
            type="button"
            onClick={() => void login()}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
          >
            使用 Casdoor 登录
            <ArrowRight className="h-4 w-4" />
          </button>

          <div className="flex flex-wrap gap-5">
            <StatusPill label="aria2" state={status.aria2} />
            <StatusPill label="local mcp" state={status.localMcp} />
            <StatusPill label="pi config" state={status.piAgentConfig} />
          </div>

          {authError ? (
            <p className="max-w-xl text-sm leading-7 text-red-600 dark:text-red-400">
              {authError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
