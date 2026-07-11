import { useEffect } from "react";
import { FolderOpen, Pause, Play, Trash2 } from "lucide-react";

import { useDownloadStore } from "@/stores/download-store";
import type { DownloadTask } from "@/types/app";

function statusLabel(status: string) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "downloading") {
    return "下载中";
  }
  if (status === "paused") {
    return "已暂停";
  }
  if (status === "failed") {
    return "失败";
  }
  return "排队中";
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return "--";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatTaskMeta(task: DownloadTask) {
  const size = formatBytes(task.totalBytes);
  if (!task.createdAtMs) {
    return size;
  }

  const time = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(task.createdAtMs);

  return `${size} · ${time}`;
}

function parseSpeedToBytesPerSecond(speed: string) {
  const matched = speed.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)\/s$/i);
  if (!matched) {
    return null;
  }

  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const unit = matched[2].toUpperCase();
  const unitMap: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };

  return value * unitMap[unit];
}

function formatRemainingTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "预计 0秒";
  }

  const seconds = Math.ceil(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainSeconds = seconds % 60;

  if (hours > 0) {
    return `预计 ${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `预计 ${minutes}分${remainSeconds}秒`;
  }
  return `预计 ${remainSeconds}秒`;
}

function getEtaLabel(task: DownloadTask) {
  if ((task.status !== "downloading" && task.status !== "queued") || !task.totalBytes) {
    return null;
  }

  const speedBytes = parseSpeedToBytesPerSecond(task.speed);
  if (!speedBytes) {
    return null;
  }

  const progress = Math.min(Math.max(task.progress, 0), 100);
  const remainingBytes = task.totalBytes * (1 - progress / 100);
  if (remainingBytes <= 0) {
    return "预计 0秒";
  }

  return formatRemainingTime(remainingBytes / speedBytes);
}

export default function DownloadsPage() {
  const hydrated = useDownloadStore((state) => state.hydrated);
  const tasks = useDownloadStore((state) => state.tasks);
  const refreshTasks = useDownloadStore((state) => state.refreshTasks);
  const openDownloadFolder = useDownloadStore((state) => state.openDownloadFolder);
  const pauseTask = useDownloadStore((state) => state.pauseTask);
  const resumeTask = useDownloadStore((state) => state.resumeTask);
  const clearHistory = useDownloadStore((state) => state.clearHistory);
  const removeTask = useDownloadStore((state) => state.removeTask);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void refreshTasks();
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hydrated, refreshTasks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex justify-end px-6 pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={tasks.length === 0}
            onClick={() => {
              if (!window.confirm("确认清空下载记录吗？这不会删除已经下载的文件。")) {
                return;
              }
              void clearHistory();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
          >
            清空记录
          </button>
          <button
            type="button"
            onClick={() => void openDownloadFolder()}
            className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
          >
            <FolderOpen className="h-4 w-4" />
            打开资源管理器
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4">
          {tasks.map((task) => {
            const etaLabel = getEtaLabel(task);

            return (
              <div
                key={task.id}
                className="space-y-3 border-b border-black/[0.06] px-1 pb-5 dark:border-white/10"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {task.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {task.status === "downloading" && task.aria2Gid ? (
                      <button
                        type="button"
                        onClick={() => void pauseTask(task.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                        aria-label={`暂停 ${task.name}`}
                      >
                        <Pause className="h-4 w-4" />
                      </button>
                    ) : null}
                    {(task.status === "paused" || task.status === "queued") && task.aria2Gid ? (
                      <button
                        type="button"
                        onClick={() => void resumeTask(task.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                        aria-label={`开始 ${task.name}`}
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </button>
                    ) : null}
                    {task.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => void openDownloadFolder(task)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                        aria-label={`打开 ${task.name} 所在目录`}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void removeTask(task.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                      aria-label={`删除 ${task.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="truncate">{formatTaskMeta(task)}</span>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{statusLabel(task.status)}</span>
                    {task.status === "downloading" || task.status === "queued" ? (
                      <>
                        <span>{task.speed}</span>
                        {etaLabel ? <span>{etaLabel}</span> : null}
                      </>
                    ) : task.status === "paused" ? (
                      <span>已暂停</span>
                    ) : null}
                  </div>
                </div>

                {task.status === "downloading" || task.status === "queued" || task.status === "paused" ? (
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
