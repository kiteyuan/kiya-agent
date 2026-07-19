import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

import type { RuntimeDefaults } from "@/types/app";

export function isTauriRuntime() {
  return isTauri();
}

export const CONFIG_STORE_KEY = "localConfig";
export const CHAT_CONVERSATIONS_STORE_KEY = "chatConversations";
export const CHAT_MESSAGES_STORE_KEY = "chatMessagesByConversation";
export const DOWNLOAD_TASKS_STORE_KEY = "downloadTasks";
export const PLAYLIST_ITEMS_STORE_KEY = "playlistItems";

const STORE_FILE_NAME = import.meta.env.DEV
  ? "kiya-agent.dev.store.json"
  : "kiya-agent.store.json";

export const store = new LazyStore(STORE_FILE_NAME, {
  defaults: {},
  autoSave: true,
});

function getPreviewRuntimeTarget(): string {
  if (typeof navigator === "undefined") {
    return "windows-x64";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("mac")) {
    return "darwin-arm64";
  }
  if (userAgent.includes("linux")) {
    return "linux-x64";
  }
  return "windows-x64";
}

function getPreviewDownloadDir(runtimeTarget: string): string {
  if (runtimeTarget.startsWith("darwin")) {
    return "/Users/runner/Downloads";
  }
  if (runtimeTarget.startsWith("linux")) {
    return "/home/runner/Downloads";
  }
  return "C:/Users/runner/Downloads";
}

export const previewRuntimeDefaults: RuntimeDefaults = {
  runtimeTarget: getPreviewRuntimeTarget(),
  downloadDir: getPreviewDownloadDir(getPreviewRuntimeTarget()),
};
