import { create } from "zustand";

import {
  getInitialDownloads,
  listDownloadTasks,
  openFolder,
  submitDownload,
} from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DownloadTask, ToolCallSummary } from "@/types/app";

interface DownloadStore {
  tasks: DownloadTask[];
  queueDownload: (query: string) => Promise<DownloadTask>;
  registerToolCalls: (toolCalls: ToolCallSummary[]) => void;
  refreshTasks: () => Promise<void>;
  markCompleted: (taskId: string) => void;
  openDownloadFolder: (targetPath?: string) => Promise<string>;
  openPlayer: (task: DownloadTask) => Promise<string>;
}

function deriveFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").pop();
    return filename && filename.trim() ? decodeURIComponent(filename) : null;
  } catch {
    return null;
  }
}

function normalizePath(output: unknown, fallbackName: string, downloadDir: string) {
  if (typeof output === "string" && output.trim()) {
    return output;
  }

  return `${downloadDir}/${fallbackName}`;
}

function parseToolCallDetail(detail: string) {
  const separatorIndex = detail.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const payload = detail.slice(separatorIndex + 1).trim();
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function matchTask(a: DownloadTask, b: DownloadTask) {
  if (a.aria2Gid && b.aria2Gid) {
    return a.aria2Gid === b.aria2Gid;
  }

  if (a.downloadUrl && b.downloadUrl) {
    return a.downloadUrl === b.downloadUrl;
  }

  return a.filePath === b.filePath;
}

export const useDownloadStore = create<DownloadStore>((set) => ({
  tasks: getInitialDownloads(useAppStore.getState().config.downloadDir),
  queueDownload: async (query) => {
    const downloadDir = useAppStore.getState().config.downloadDir;
    const task = await submitDownload(query, downloadDir);
    set((state) => ({
      tasks: [task, ...state.tasks],
    }));
    return task;
  },
  registerToolCalls: (toolCalls) => {
    const newTasks = toolCalls
      .filter((toolCall) => toolCall.tool === "download_file")
      .map((toolCall) => {
        const downloadDir = useAppStore.getState().config.downloadDir;
        const payload = parseToolCallDetail(toolCall.detail);
        const url =
          payload && typeof payload.url === "string" ? payload.url : undefined;
        if (!url) {
          return null;
        }

        const fallbackName = deriveFilenameFromUrl(url) ?? "download.mp4";
        const filePath = normalizePath(payload.output, fallbackName, downloadDir);

        const task: DownloadTask = {
          id: crypto.randomUUID(),
          name: fallbackName.replace(/\.[^/.]+$/, "") || fallbackName,
          status: "downloading" as const,
          progress: 0,
          speed: "等待 aria2",
          filePath,
          source: "Pi Agent",
          downloadUrl: url,
        };
        return task;
      })
      .filter((task) => task !== null);

    if (newTasks.length === 0) {
      return;
    }

    set((state) => {
      const existingUrls = new Set(
        state.tasks.map((task) => task.downloadUrl).filter(Boolean),
      );

      return {
        tasks: [
          ...newTasks.filter((task) => !existingUrls.has(task.downloadUrl)),
          ...state.tasks,
        ],
      };
    });
  },
  refreshTasks: async () => {
    try {
      const daemonTasks = await listDownloadTasks();
      set((state) => {
        const mergedTasks = state.tasks.map((task) => {
          const daemonTask = daemonTasks.find((candidate) =>
            matchTask(task, candidate),
          );

          return daemonTask
            ? {
                ...task,
                ...daemonTask,
                id: task.id,
              }
            : task;
        });

        const extraTasks = daemonTasks.filter(
          (daemonTask) =>
            !mergedTasks.some((task) => matchTask(task, daemonTask)),
        );

        return {
          tasks: [...mergedTasks, ...extraTasks].sort((left, right) =>
            right.status === "downloading" && left.status !== "downloading"
              ? 1
              : left.status === "downloading" && right.status !== "downloading"
                ? -1
                : 0,
          ),
        };
      });
    } catch {
      return;
    }
  },
  markCompleted: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "completed", progress: 100, speed: "0 MB/s" }
          : task,
      ),
    }));
  },
  openDownloadFolder: async (targetPath) => openFolder(targetPath),
  openPlayer: async (task) => {
    const source = task.filePath.trim();
    if (!source) {
      return "";
    }

    usePlaylistStore.getState().openSource(source, {
      title: task.name,
      origin: "download",
    });
    return source;
  },
}));
