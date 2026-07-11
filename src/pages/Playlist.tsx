import { ListVideo, Play, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { usePlaylistStore } from "@/stores/playlist-store";

export default function PlaylistPage() {
  const allItems = usePlaylistStore((state) => state.items);
  const openItem = usePlaylistStore((state) => state.openItem);
  const clearHistory = usePlaylistStore((state) => state.clearHistory);
  const removeItem = usePlaylistStore((state) => state.removeItem);
  const items = useMemo(
    () => allItems.filter((item) => item.kind === "remote-url"),
    [allItems],
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex justify-end px-6 pt-5">
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => {
              if (!window.confirm("确认清空播放历史吗？这不会删除任何本地文件。")) {
                return;
              }
              void clearHistory();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
          >
            清空记录
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <ListVideo className="h-4 w-4" />
              <span>{items.length} 项</span>
            </div>
            {items.length === 0 ? (
              <div className="border-b border-black/[0.06] px-1 pb-5 text-sm leading-6 text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                还没有在线播放记录。后续当 MCP 调用 `play_video` 并传入视频直链时，会自动出现在这里。
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-1 py-4 dark:border-white/10"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {item.source}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
                        {item.kind === "remote-url" ? "直链" : "本地"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.addedAt}
                      </p>
                    </div>
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
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
