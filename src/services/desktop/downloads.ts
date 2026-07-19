import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { DownloadTask, PlaylistItem } from "@/types/app";

import { defaultConfig } from "./defaults";
import {
  DOWNLOAD_TASKS_STORE_KEY,
  isTauriRuntime,
  PLAYLIST_ITEMS_STORE_KEY,
} from "./runtime";

export function getInitialDownloads(
  downloadDir = defaultConfig.downloadDir,
): DownloadTask[] {
  void downloadDir;
  return [];
}

export function getInitialPlaylist(
  downloadDir = defaultConfig.downloadDir,
): PlaylistItem[] {
  void downloadDir;
  return [];
}

export async function submitDownload(
  query: string,
  downloadDir = defaultConfig.downloadDir,
  output?: string,
): Promise<DownloadTask> {
  const title = query.trim() || "未命名资源";

  if (isTauriRuntime()) {
    return invoke<DownloadTask>("submit_download_request", {
      url: query,
      output,
      downloadDir,
      allowedRoot: downloadDir,
    });
  }

  return {
    id: crypto.randomUUID(),
    name: output?.replace(/\.[^/.]+$/, "") || title,
    status: "downloading",
    progress: 24,
    speed: "8.4 MB/s",
    createdAtMs: Date.now(),
    filePath: `${downloadDir}/${output ?? `${title}.mp4`}`,
    source: "远程 MCP",
    downloadUrl: query,
  };
}

export async function playVideo(task: DownloadTask): Promise<string> {
  return openMediaSource(task.filePath, defaultConfig.downloadDir);
}

export async function openMediaSource(
  source: string,
  allowedRoot = defaultConfig.downloadDir,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("open_media_file", {
      filePath: source,
      allowedRoot,
    });
  }

  return `已请求播放器打开 ${source}`;
}

export async function openFolder(
  targetPath?: string,
  allowedRoot = defaultConfig.downloadDir,
): Promise<string> {
  const resolvedTarget = targetPath?.trim() || allowedRoot;

  if (isTauriRuntime()) {
    return invoke<string>("open_folder_path", {
      targetPath: resolvedTarget,
      allowedRoot,
    });
  }

  return resolvedTarget;
}

export async function openExternalUrl(url: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("open_external_url", {
      url,
    });
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export async function selectDownloadDirectory(
  currentPath?: string,
  title?: string,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: currentPath?.trim() || undefined,
    title: title?.trim() || "选择下载目录",
  });

  if (typeof selected === "string") {
    return selected;
  }

  return null;
}

export async function listDownloadTasks(): Promise<DownloadTask[]> {
  if (isTauriRuntime()) {
    return invoke<DownloadTask[]>("list_download_tasks");
  }

  return getInitialDownloads(defaultConfig.downloadDir);
}

export async function listDownloadHistory(): Promise<DownloadTask[]> {
  if (isTauriRuntime()) {
    return invoke<DownloadTask[]>("list_download_history");
  }

  const rawTasks = localStorage.getItem(DOWNLOAD_TASKS_STORE_KEY);
  if (!rawTasks) {
    return [];
  }

  try {
    return JSON.parse(rawTasks) as DownloadTask[];
  } catch {
    return [];
  }
}

export async function saveDownloadHistory(
  tasks: DownloadTask[],
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("save_download_history", {
      tasks,
    });
    return;
  }

  localStorage.setItem(DOWNLOAD_TASKS_STORE_KEY, JSON.stringify(tasks));
}

export async function pauseDownload(aria2Gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("pause_download_task", {
    aria2Gid,
  });
}

export async function resumeDownload(aria2Gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("resume_download_task", {
    aria2Gid,
  });
}

export async function clearDownloadTask(
  task: Pick<DownloadTask, "status" | "aria2Gid" | "filePath">,
  allowedRoot = defaultConfig.downloadDir,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>("clear_download_task", {
    aria2Gid: task.aria2Gid ?? null,
    filePath: task.filePath,
    deleteFiles: task.status !== "completed",
    allowedRoot,
  });
}

export async function listPlaylistHistory(): Promise<PlaylistItem[]> {
  if (isTauriRuntime()) {
    return invoke<PlaylistItem[]>("list_playlist_history");
  }

  const rawItems = localStorage.getItem(PLAYLIST_ITEMS_STORE_KEY);
  if (!rawItems) {
    return [];
  }

  try {
    return JSON.parse(rawItems) as PlaylistItem[];
  } catch {
    return [];
  }
}

export async function savePlaylistHistory(
  items: PlaylistItem[],
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("save_playlist_history", {
      items,
    });
    return;
  }

  localStorage.setItem(PLAYLIST_ITEMS_STORE_KEY, JSON.stringify(items));
}
