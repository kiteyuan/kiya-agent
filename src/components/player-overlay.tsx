import { X } from "lucide-react";

import { PlayerSurface } from "@/player/player-surface";
import { openMediaSource } from "@/services/desktop";
import { usePlaylistStore } from "@/stores/playlist-store";

export function PlayerOverlay() {
  const activeItem = usePlaylistStore((state) => state.activeItem);
  const closeActiveItem = usePlaylistStore((state) => state.closeActiveItem);

  if (!activeItem) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6 py-8 backdrop-blur-sm">
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-[32px] bg-[var(--app-bg)] p-5 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between gap-4 px-2">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
              {activeItem.title}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {activeItem.source}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void openMediaSource(activeItem.source)}
              className="rounded-full bg-black/[0.04] px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
            >
              系统打开
            </button>
            <button
              type="button"
              onClick={closeActiveItem}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-zinc-600 transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
              aria-label="关闭播放器"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[28px] bg-black/[0.03] p-4 dark:bg-white/[0.04]">
          <PlayerSurface title={activeItem.title} path={activeItem.source} />
        </div>
      </div>
    </div>
  );
}
