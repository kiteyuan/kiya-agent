import { ListVideo, Play } from "lucide-react";
import { useMemo } from "react";

import { usePlaylistStore } from "@/stores/playlist-store";

export default function PlaylistPage() {
  const allItems = usePlaylistStore((state) => state.items);
  const openItem = usePlaylistStore((state) => state.openItem);
  const items = useMemo(
    () => allItems.filter((item) => item.kind === "remote-url"),
    [allItems],
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/10">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              History
            </p>
            <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              播放历史
            </h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <ListVideo className="h-4 w-4" />
            <span>{items.length} 项</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-3">
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
