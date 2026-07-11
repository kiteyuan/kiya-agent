import { X } from "lucide-react";

import { PlayerSurface } from "@/player/player-surface";
import { usePlaylistStore } from "@/stores/playlist-store";

export function PlayerOverlay() {
  const activeItem = usePlaylistStore((state) => state.activeItem);
  const closeActiveItem = usePlaylistStore((state) => state.closeActiveItem);

  if (!activeItem) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <button
        type="button"
        onClick={closeActiveItem}
        className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
        aria-label="关闭播放器"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="h-auto w-full max-w-6xl">
        <PlayerSurface path={activeItem.source} />
      </div>
    </div>
  );
}
