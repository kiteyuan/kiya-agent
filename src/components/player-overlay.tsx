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
    <div className="fixed inset-0 z-50 bg-black/80">
      <button
        type="button"
        onClick={closeActiveItem}
        className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
        aria-label="关闭播放器"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex h-full items-center justify-center p-8 md:p-10">
        <div className="flex h-full max-h-[calc(100vh-10rem)] w-full max-w-[1080px] items-center justify-center">
          <PlayerSurface path={activeItem.source} />
        </div>
      </div>
    </div>
  );
}
