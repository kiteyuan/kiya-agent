import { create } from "zustand";

import {
  defaultConfig,
  loadConfig,
  mergeRemoteMcpServers,
  readAppStatusDetails,
  readRuntimeDefaults,
  saveConfig,
} from "@/services/desktop";
import type { AppBootstrapStatus, LocalConfig } from "@/types/app";

interface AppStore {
  status: AppBootstrapStatus;
  config: LocalConfig;
  logs: string[];
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  updateConfig: (patch: Partial<LocalConfig>) => void;
}

const initialStatus: AppBootstrapStatus = {
  aria2: "starting",
  localMcp: "starting",
  piAgentConfig: "missing",
};

export const useAppStore = create<AppStore>((set) => ({
  status: initialStatus,
  config: defaultConfig,
  logs: [
    "[bootstrap] 等待桌面宿主初始化",
    "[mcp] 预期加载 3 个本地工具",
  ],
  bootstrapped: false,
  bootstrap: async () => {
    const [payload, runtimeDefaults, savedConfig] = await Promise.all([
      readAppStatusDetails(),
      readRuntimeDefaults(),
      loadConfig(),
    ]);

    const resolvedConfig: LocalConfig = {
      ...defaultConfig,
      ...savedConfig,
      remoteMcpServers: mergeRemoteMcpServers(savedConfig?.remoteMcpServers),
      downloadDir:
        savedConfig?.downloadDir?.trim() || runtimeDefaults.downloadDir,
    };

    set(() => ({
      status: payload.status,
      config: resolvedConfig,
      bootstrapped: true,
      logs: payload.logs,
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
