import { useEffect, useState } from "react";
import { FolderOpen, Pause, Play, RotateCcw, Trash2 } from "lucide-react";

import { getIntlLocale, useI18n } from "@/i18n";
import { useDownloadStore } from "@/stores/download-store";
import type { DownloadTask } from "@/types/app";

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

export default function DownloadsPage() {
  const { language, t } = useI18n();
  const hydrated = useDownloadStore((state) => state.hydrated);
  const tasks = useDownloadStore((state) => state.tasks);
  const refreshTasks = useDownloadStore((state) => state.refreshTasks);
  const openDownloadFolder = useDownloadStore((state) => state.openDownloadFolder);
  const pauseTask = useDownloadStore((state) => state.pauseTask);
  const resumeTask = useDownloadStore((state) => state.resumeTask);
  const retryTask = useDownloadStore((state) => state.retryTask);
  const clearHistory = useDownloadStore((state) => state.clearHistory);
  const removeTask = useDownloadStore((state) => state.removeTask);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  function statusLabel(status: string) {
    if (status === "completed") {
      return t("downloads.status.completed");
    }
    if (status === "downloading") {
      return t("downloads.status.downloading");
    }
    if (status === "paused") {
      return t("downloads.status.paused");
    }
    if (status === "failed") {
      return t("downloads.status.failed");
    }
    return t("downloads.status.queued");
  }

  function formatRemainingTime(totalSeconds: number) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return t("downloads.eta", { value: t("downloads.etaSeconds", { seconds: 0 }) });
    }

    const seconds = Math.ceil(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainSeconds = seconds % 60;

    if (hours > 0) {
      return t("downloads.eta", {
        value: t("downloads.etaHoursMinutes", { hours, minutes }),
      });
    }
    if (minutes > 0) {
      return t("downloads.eta", {
        value: t("downloads.etaMinutesSeconds", {
          minutes,
          seconds: remainSeconds,
        }),
      });
    }
    return t("downloads.eta", {
      value: t("downloads.etaSeconds", { seconds: remainSeconds }),
    });
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
      return t("downloads.eta", {
        value: t("downloads.etaSeconds", { seconds: 0 }),
      });
    }

    return formatRemainingTime(remainingBytes / speedBytes);
  }

  function formatTaskMeta(task: DownloadTask) {
    if (!task.createdAtMs) {
      return formatBytes(task.totalBytes);
    }

    const time = new Intl.DateTimeFormat(getIntlLocale(language), {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(task.createdAtMs);

    return `${time} · ${formatBytes(task.totalBytes)}`;
  }

  function formatSpeed(task: DownloadTask) {
    return task.speed === "等待 aria2" ? t("downloads.waitingAria2") : task.speed;
  }

  function formatTaskSecondaryLine(task: DownloadTask) {
    const parts = [formatTaskMeta(task), statusLabel(task.status)];
    const etaLabel = getEtaLabel(task);

    if (task.status === "downloading" || task.status === "queued") {
      parts.push(formatSpeed(task));
      if (etaLabel) {
        parts.push(etaLabel);
      }
    } else if (task.status === "paused") {
      parts.push(t("downloads.paused"));
    }

    return parts.join(" · ");
  }

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

  async function handleConfirmClearHistory() {
    if (tasks.length === 0 || isClearingHistory) {
      return;
    }

    setIsClearingHistory(true);
    try {
      await clearHistory();
      setIsConfirmingClear(false);
    } finally {
      setIsClearingHistory(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 pb-24">
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-3xl bg-white px-4 py-4 dark:bg-zinc-900/80"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {task.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {formatTaskSecondaryLine(task)}
                  </p>
                  {task.status === "downloading" ||
                  task.status === "queued" ||
                  task.status === "paused" ? (
                    <div className="pt-1">
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex w-36 shrink-0 items-center justify-end gap-3">
                  {task.status === "downloading" && task.aria2Gid ? (
                    <button
                      type="button"
                      onClick={() => void pauseTask(task.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                      aria-label={t("downloads.pause", { name: task.name })}
                    >
                      <Pause className="h-4 w-4" />
                    </button>
                  ) : null}
                  {(task.status === "paused" || task.status === "queued") && task.aria2Gid ? (
                    <button
                      type="button"
                      onClick={() => void resumeTask(task.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                      aria-label={t("downloads.resume", { name: task.name })}
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </button>
                  ) : null}
                  {task.status === "completed" ? (
                    <button
                      type="button"
                      onClick={() => void openDownloadFolder(task)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                      aria-label={t("downloads.openFolder", { name: task.name })}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </button>
                  ) : null}
                  {task.status === "failed" && task.downloadUrl ? (
                    <button
                      type="button"
                      onClick={() => void retryTask(task.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                      aria-label={t("downloads.retry", { name: task.name })}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void removeTask(task.id)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                    aria-label={t("downloads.delete", { name: task.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={tasks.length === 0}
        onClick={() => setIsConfirmingClear(true)}
        className="absolute bottom-6 right-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
        aria-label={t("downloads.clearHistory")}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {isConfirmingClear ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm dark:bg-black/40">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-zinc-950 shadow-[0_12px_40px_rgba(0,0,0,0.12)] dark:bg-zinc-900 dark:text-zinc-100">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("downloads.clearHistoryTitle")}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("downloads.clearHistoryDescription")}
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isClearingHistory}
                onClick={() => setIsConfirmingClear(false)}
                className="inline-flex h-10 items-center justify-center rounded-full bg-black/[0.04] px-4 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
              >
                {t("app.cancel")}
              </button>
              <button
                type="button"
                disabled={isClearingHistory}
                onClick={() => void handleConfirmClearHistory()}
                className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
              >
                {isClearingHistory ? t("downloads.clearing") : t("app.confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
