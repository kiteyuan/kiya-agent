import { useEffect } from "react";
import { FolderOpen, Play } from "lucide-react";

import { useDownloadStore } from "@/stores/download-store";

function statusLabel(status: string) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "downloading") {
    return "下载中";
  }
  if (status === "failed") {
    return "失败";
  }
  return "排队中";
}

export default function DownloadsPage() {
  const tasks = useDownloadStore((state) => state.tasks);
  const refreshTasks = useDownloadStore((state) => state.refreshTasks);
  const openDownloadFolder = useDownloadStore((state) => state.openDownloadFolder);
  const openPlayer = useDownloadStore((state) => state.openPlayer);

  useEffect(() => {
    void refreshTasks();
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshTasks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/10">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
            Queue
          </p>
          <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            下载任务
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void openDownloadFolder()}
          className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
        >
          <FolderOpen className="h-4 w-4" />
          打开资源管理器
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="space-y-4 border-b border-black/[0.06] px-1 pb-5 dark:border-white/10"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {task.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {task.filePath}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{statusLabel(task.status)}</span>
                  <span>{task.speed}</span>
                </div>
              </div>

              <div className="h-[3px] w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100"
                  style={{ width: `${task.progress}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">
                  {task.source}
                </p>
                <button
                  type="button"
                  onClick={() => void openPlayer(task)}
                  className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <Play className="h-4 w-4" />
                  应用内播放
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
