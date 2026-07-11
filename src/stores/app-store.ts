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
  configDirty: boolean;
  configSaving: boolean;
  bootstrap: () => Promise<void>;
  updateConfig: (patch: Partial<LocalConfig>) => void;
  persistConfig: () => Promise<void>;
}

const initialStatus: AppBootstrapStatus = {
  aria2: "starting",
  localMcp: "starting",
  piAgentConfig: "missing",
};

function resolveDownloadDir(
  savedDownloadDir: string | undefined,
  runtimeDownloadDir: string,
) {
  const trimmed = savedDownloadDir?.trim();
  return trimmed || runtimeDownloadDir;
}

export const useAppStore = create<AppStore>((set) => ({
  status: initialStatus,
  config: defaultConfig,
  logs: [
    "[bootstrap] 等待桌面宿主初始化",
    "[mcp] 预期加载 3 个本地工具",
  ],
  bootstrapped: false,
  configDirty: false,
  configSaving: false,
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
      downloadDir: resolveDownloadDir(
        savedConfig?.downloadDir,
        runtimeDefaults.downloadDir,
      ),
    };

    set(() => ({
      status: payload.status,
      config: resolvedConfig,
      bootstrapped: true,
      configDirty: false,
      configSaving: false,
      logs: payload.logs,
    }));
  },
  updateConfig: (patch) => {
    set((state) => {
      const nextConfig = { ...state.config, ...patch };
      return {
        config: nextConfig,
        configDirty: true,
        logs: [...state.logs, "[config] 已更新本地配置草稿"],
      };
    });
  },
  persistConfig: async () => {
    const { config } = useAppStore.getState();
    set((state) => ({
      configSaving: true,
      logs: [...state.logs, "[config] 正在保存本地配置"],
    }));

    try {
      await saveConfig(config);
      set((state) => ({
        configDirty: false,
        configSaving: false,
        logs: [...state.logs, "[config] 本地配置已保存"],
      }));
    } catch (error) {
      set((state) => ({
        configSaving: false,
        logs: [
          ...state.logs,
          `[config] 保存失败: ${error instanceof Error ? error.message : "未知错误"}`,
        ],
      }));
      throw error;
    }
  },
}));
