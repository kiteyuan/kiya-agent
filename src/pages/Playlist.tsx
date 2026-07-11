import { Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { usePlaylistStore } from "@/stores/playlist-store";

export default function PlaylistPage() {
  const allItems = usePlaylistStore((state) => state.items);
  const openItem = usePlaylistStore((state) => state.openItem);
  const clearHistory = usePlaylistStore((state) => state.clearHistory);
  const removeItem = usePlaylistStore((state) => state.removeItem);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const items = useMemo(
    () => allItems.filter((item) => item.kind === "remote-url"),
    [allItems],
  );

  async function handleConfirmClearHistory() {
    if (items.length === 0 || isClearingHistory) {
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
    <>
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 pb-24">
          <div className="space-y-3">
            {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-4 rounded-3xl bg-white px-4 py-4 dark:bg-zinc-900/80"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {item.addedAt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                      aria-label={`播放 ${item.title}`}
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeItem(item.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-500 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                      aria-label={`删除 ${item.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => setIsConfirmingClear(true)}
          className="absolute bottom-6 right-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
          aria-label="清空播放历史"
        >
          <Trash2 className="h-4 w-4" />
        </button>

        {isConfirmingClear ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm dark:bg-black/40">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-zinc-950 shadow-[0_12px_40px_rgba(0,0,0,0.12)] dark:bg-zinc-900 dark:text-zinc-100">
              <div className="space-y-2">
                <p className="text-sm font-medium">清空播放历史？</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  这不会删除任何本地文件。
                </p>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isClearingHistory}
                  onClick={() => setIsConfirmingClear(false)}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-black/[0.04] px-4 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isClearingHistory}
                  onClick={() => void handleConfirmClearHistory()}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                >
                  {isClearingHistory ? "清空中" : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
