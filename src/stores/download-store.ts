import { create } from "zustand";

import {
  clearDownloadTask,
  listDownloadHistory,
  listDownloadTasks,
  openFolder,
  pauseDownload,
  resumeDownload,
  saveDownloadHistory,
  submitDownload,
} from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import type { DownloadTask, ToolCallSummary } from "@/types/app";

interface DownloadStore {
  hydrated: boolean;
  tasks: DownloadTask[];
  unreadCount: number;
  hydrate: () => Promise<void>;
  clearHistory: () => Promise<void>;
  removeTask: (taskId: string) => Promise<void>;
  markAllSeen: () => void;
  queueDownload: (query: string) => Promise<DownloadTask>;
  registerToolCalls: (toolCalls: ToolCallSummary[]) => void;
  refreshTasks: () => Promise<void>;
  markCompleted: (taskId: string) => void;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  openDownloadFolder: (task?: DownloadTask) => Promise<string>;
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

function resolveOutputName(output: unknown, fallbackName: string) {
  if (typeof output !== "string") {
    return fallbackName;
  }

  const trimmed = output.trim();
  if (!trimmed) {
    return fallbackName;
  }

  return trimmed;
}

function normalizePath(output: unknown, fallbackName: string, downloadDir: string) {
  const fileName = resolveOutputName(output, fallbackName);
  return `${downloadDir}/${fileName}`;
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

function normalizeComparableUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function normalizeComparablePath(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (/^[A-Z]:/.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  }

  return normalized;
}

function matchTask(a: DownloadTask, b: DownloadTask) {
  if (a.aria2Gid && b.aria2Gid) {
    return a.aria2Gid === b.aria2Gid;
  }

  const normalizedUrlA = normalizeComparableUrl(a.downloadUrl);
  const normalizedUrlB = normalizeComparableUrl(b.downloadUrl);
  if (normalizedUrlA && normalizedUrlB) {
    return normalizedUrlA === normalizedUrlB;
  }

  const normalizedPathA = normalizeComparablePath(a.filePath);
  const normalizedPathB = normalizeComparablePath(b.filePath);
  return normalizedPathA !== null && normalizedPathA === normalizedPathB;
}

function mergeTaskWithDaemonTask(task: DownloadTask, daemonTask?: DownloadTask) {
  if (!daemonTask) {
    return task;
  }

  return {
    ...task,
    ...daemonTask,
    id: task.id,
    totalBytes: daemonTask.totalBytes ?? task.totalBytes,
    createdAtMs:
      task.createdAtMs ?? daemonTask.createdAtMs ?? Date.now(),
  };
}

function takeMatchingDaemonTask(
  candidates: DownloadTask[],
  predicate: (candidate: DownloadTask) => boolean,
) {
  const index = candidates.findIndex(predicate);
  if (index === -1) {
    return undefined;
  }

  const [matched] = candidates.splice(index, 1);
  return matched;
}

function sortTasks(tasks: DownloadTask[]) {
  return [...tasks].sort((left, right) =>
    right.status === "downloading" && left.status !== "downloading"
      ? 1
      : left.status === "downloading" && right.status !== "downloading"
        ? -1
        : left.status === "paused" && right.status !== "paused"
          ? -1
          : right.status === "paused" && left.status !== "paused"
            ? 1
            : 0,
  );
}

async function persistTasks(tasks: DownloadTask[]) {
  try {
    await saveDownloadHistory(tasks);
  } catch {
    return;
  }
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  hydrated: false,
  tasks: [],
  unreadCount: 0,
  hydrate: async () => {
    if (get().hydrated) {
      return;
    }

    const tasks = await listDownloadHistory();
    set(() => ({
      hydrated: true,
      tasks: sortTasks(tasks),
    }));
  },
  clearHistory: async () => {
    const tasksToClear = get().tasks;
    await Promise.allSettled(
      tasksToClear.map((task) => clearDownloadTask(task)),
    );

    set(() => ({
      tasks: [],
      unreadCount: 0,
    }));
    await persistTasks([]);
  },
  removeTask: async (taskId) => {
    const currentTasks = get().tasks;
    const taskToRemove = currentTasks.find((task) => task.id === taskId);
    const nextTasks = currentTasks.filter((task) => task.id !== taskId);
    if (nextTasks.length === currentTasks.length) {
      return;
    }

    if (taskToRemove) {
      await clearDownloadTask(taskToRemove);
    }

    set(() => ({
      tasks: nextTasks,
    }));
    await persistTasks(nextTasks);
  },
  markAllSeen: () => {
    if (get().unreadCount === 0) {
      return;
    }

    set(() => ({
      unreadCount: 0,
    }));
  },
  queueDownload: async (query) => {
    const downloadDir = useAppStore.getState().config.downloadDir;
    const task = await submitDownload(query, downloadDir);
    const nextTasks = [task, ...get().tasks];
    set(() => ({
      tasks: nextTasks,
      unreadCount: get().unreadCount + 1,
    }));
    void persistTasks(nextTasks);
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
        const resolvedName = resolveOutputName(payload.output, fallbackName);
        const filePath = normalizePath(payload.output, fallbackName, downloadDir);

        const task: DownloadTask = {
          id: crypto.randomUUID(),
          name: resolvedName.replace(/\.[^/.]+$/, "") || resolvedName,
          status: "downloading" as const,
          progress: 0,
          speed: "等待 aria2",
          createdAtMs: Date.now(),
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

    const currentTasks = get().tasks;
    const nextTasks = [...newTasks, ...currentTasks];
    const addedCount = nextTasks.length - currentTasks.length;

    set(() => ({
      tasks: nextTasks,
      unreadCount: get().unreadCount + Math.max(addedCount, 0),
    }));
    void persistTasks(nextTasks);

    if (get().hydrated) {
      [0, 800, 2000].forEach((delayMs) => {
        window.setTimeout(() => {
          void get().refreshTasks();
        }, delayMs);
      });
    }
  },
  refreshTasks: async () => {
    if (!get().hydrated) {
      return;
    }

    try {
      const daemonTasks = await listDownloadTasks();
      const currentTasks = get().tasks;
      const remainingDaemonTasks = [...daemonTasks];
      const matchedDaemonTasks = new Map<string, DownloadTask>();

      currentTasks.forEach((task) => {
        if (!task.aria2Gid) {
          return;
        }

        const daemonTask = takeMatchingDaemonTask(
          remainingDaemonTasks,
          (candidate) => candidate.aria2Gid === task.aria2Gid,
        );
        if (daemonTask) {
          matchedDaemonTasks.set(task.id, daemonTask);
        }
      });

      currentTasks.forEach((task) => {
        if (matchedDaemonTasks.has(task.id)) {
          return;
        }

        const normalizedPath = normalizeComparablePath(task.filePath);
        if (!normalizedPath) {
          return;
        }

        const daemonTask = takeMatchingDaemonTask(
          remainingDaemonTasks,
          (candidate) =>
            normalizeComparablePath(candidate.filePath) === normalizedPath,
        );
        if (daemonTask) {
          matchedDaemonTasks.set(task.id, daemonTask);
        }
      });

      currentTasks.forEach((task) => {
        if (matchedDaemonTasks.has(task.id)) {
          return;
        }

        const normalizedUrl = normalizeComparableUrl(task.downloadUrl);
        if (!normalizedUrl) {
          return;
        }

        const daemonTask = takeMatchingDaemonTask(
          remainingDaemonTasks,
          (candidate) =>
            normalizeComparableUrl(candidate.downloadUrl) === normalizedUrl,
        );
        if (daemonTask) {
          matchedDaemonTasks.set(task.id, daemonTask);
        }
      });

      const mergedTasks = currentTasks.map((task) =>
        mergeTaskWithDaemonTask(task, matchedDaemonTasks.get(task.id)),
      );
      const extraTasks = remainingDaemonTasks;
      const nextTasks = sortTasks([
        ...mergedTasks,
        ...extraTasks.map((task) => ({
          ...task,
          createdAtMs: task.createdAtMs ?? Date.now(),
        })),
      ]);

      set(() => ({
        tasks: nextTasks,
        unreadCount: get().unreadCount + extraTasks.length,
      }));
      void persistTasks(nextTasks);
    } catch {
      return;
    }
  },
  markCompleted: (taskId) => {
    const nextTasks: DownloadTask[] = get().tasks.map((task) =>
      task.id === taskId
        ? { ...task, status: "completed" as const, progress: 100, speed: "0 MB/s" }
        : task,
    );
    set(() => ({
      tasks: nextTasks,
    }));
    void persistTasks(nextTasks);
  },
  pauseTask: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    const gid = task?.aria2Gid;
    if (!gid) {
      return;
    }

    await pauseDownload(gid);
    const nextTasks = sortTasks(
      get().tasks.map((item) =>
        item.id === taskId
          ? { ...item, status: "paused" as const, speed: "已暂停" }
          : item,
      ),
    );
    set(() => ({
      tasks: nextTasks,
    }));
    void persistTasks(nextTasks);
  },
  resumeTask: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    const gid = task?.aria2Gid;
    if (!gid) {
      return;
    }

    await resumeDownload(gid);
    const nextTasks = sortTasks(
      get().tasks.map((item) =>
        item.id === taskId
          ? { ...item, status: "downloading" as const, speed: "恢复中" }
          : item,
      ),
    );
    set(() => ({
      tasks: nextTasks,
    }));
    void persistTasks(nextTasks);
  },
  openDownloadFolder: async (task) => {
    if (!task) {
      return openFolder();
    }

    let resolvedPath = task.filePath;

    if (task.aria2Gid) {
      try {
        const daemonTasks = await listDownloadTasks();
        const daemonTask = daemonTasks.find((candidate) =>
          matchTask(task, candidate),
        );

        if (daemonTask?.filePath?.trim()) {
          resolvedPath = daemonTask.filePath;

          const nextTasks = get().tasks.map((item) =>
            item.id === task.id ? { ...item, filePath: daemonTask.filePath } : item,
          );
          set(() => ({
            tasks: nextTasks,
          }));
          void persistTasks(nextTasks);
        }
      } catch {
        // Fall back to the last known local path if aria2 cannot be queried.
      }
    }

    return openFolder(resolvedPath);
  },
}));
