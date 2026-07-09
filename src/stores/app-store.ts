import { create } from "zustand";

import {
  defaultConfig,
  loadConfig,
  loadSession,
  mergeRemoteMcpServers,
  logoutSession,
  readAppStatusDetails,
  readRuntimeDefaults,
  saveConfig,
  startLoginFlow,
} from "@/services/desktop";
import type { AppBootstrapStatus, AuthSession, LocalConfig } from "@/types/app";

interface AppStore {
  status: AppBootstrapStatus;
  session: AuthSession | null;
  config: LocalConfig;
  logs: string[];
  authError: string | null;
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateConfig: (patch: Partial<LocalConfig>) => void;
}

const initialStatus: AppBootstrapStatus = {
  aria2: "starting",
  localMcp: "starting",
  oauthCallback: "starting",
  piAgentConfig: "missing",
};

export const useAppStore = create<AppStore>((set) => ({
  status: initialStatus,
  session: null,
  config: defaultConfig,
  logs: [
    "[bootstrap] 等待桌面宿主初始化",
    "[mcp] 预期加载 3 个本地工具",
  ],
  authError: null,
  bootstrapped: false,
  bootstrap: async () => {
    const [payload, runtimeDefaults, savedConfig, session] = await Promise.all([
      readAppStatusDetails(),
      readRuntimeDefaults(),
      loadConfig(),
      loadSession(),
    ]);

    const resolvedConfig: LocalConfig = {
      ...defaultConfig,
      ...savedConfig,
      remoteMcpServers: mergeRemoteMcpServers(savedConfig?.remoteMcpServers),
      downloadDir:
        savedConfig?.downloadDir?.trim() || runtimeDefaults.downloadDir,
    };

    set(() => ({
      session,
      status: payload.status,
      config: resolvedConfig,
      authError: null,
      bootstrapped: true,
      logs: payload.logs,
    }));
  },
  login: async () => {
    const config = useAppStore.getState().config;

    try {
      const session = await startLoginFlow(config);
      set((state) => ({
        authError: null,
        session,
        logs: [...state.logs, `[auth] 已登录 ${session.user.name}`],
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Casdoor 登录失败";
      set((state) => ({
        authError: message,
        logs: [...state.logs, `[auth] ${message}`],
      }));
    }
  },
  logout: async () => {
    await logoutSession();
    set((state) => ({
      authError: null,
      session: null,
      logs: [...state.logs, "[auth] 已清理本地登录态"],
    }));
  },
  updateConfig: (patch) => {
    set((state) => {
      const nextConfig = { ...state.config, ...patch };
      void saveConfig(nextConfig);
      return {
        config: nextConfig,
        logs: [...state.logs, "[config] 已更新本地配置草稿"],
      };
    });
  },
}));
