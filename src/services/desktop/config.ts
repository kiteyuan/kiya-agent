import type { LocalConfig } from "@/types/app";

import { mergeRemoteMcpServers } from "./defaults";
import {
  CONFIG_STORE_KEY,
  isTauriRuntime,
  store,
} from "./runtime";

function normalizeSavedModelDefaults(
  config: Partial<LocalConfig> | null,
): Partial<LocalConfig> | null {
  if (!config) {
    return null;
  }

  const provider = config.modelProvider;
  const modelName = config.modelName?.trim();
  const isLegacyDefault =
    provider === "openai" &&
    (!modelName || modelName === "gpt-4.1-mini");

  if (!provider || isLegacyDefault) {
    return {
      ...config,
      modelProvider: "deepseek",
      modelName: "deepseek-v4-flash",
      autoApproveTools: config.autoApproveTools ?? true,
    };
  }

  return {
    ...config,
    autoApproveTools: config.autoApproveTools ?? true,
  };
}

export async function saveConfig(config: LocalConfig): Promise<void> {
  if (isTauriRuntime()) {
    await store.set(CONFIG_STORE_KEY, config);
    await store.save();
    return;
  }

  localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(config));
}

export async function loadConfig(): Promise<Partial<LocalConfig> | null> {
  if (isTauriRuntime()) {
    const config = normalizeSavedModelDefaults(
      (await store.get<Partial<LocalConfig>>(CONFIG_STORE_KEY)) ?? null,
    );
    return config
      ? {
          ...config,
          remoteMcpServers: mergeRemoteMcpServers(config.remoteMcpServers),
        }
      : null;
  }

  const rawConfig = localStorage.getItem(CONFIG_STORE_KEY);
  if (!rawConfig) {
    return null;
  }

  const parsed = normalizeSavedModelDefaults(
    JSON.parse(rawConfig) as Partial<LocalConfig>,
  );
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    remoteMcpServers: mergeRemoteMcpServers(parsed.remoteMcpServers),
  };
}
