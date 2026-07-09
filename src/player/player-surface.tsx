import Artplayer from "artplayer";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

interface PlayerSurfaceProps {
  title: string;
  path: string;
  onPlay?: () => void;
}

function isRemoteUrl(path: string) {
  return /^https?:\/\//i.test(path);
}

export function PlayerSurface({ title, path, onPlay }: PlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoUrl = useMemo(() => {
    if (!path) {
      return "";
    }

    if (isRemoteUrl(path)) {
      return path;
    }

    if (isTauri()) {
      return convertFileSrc(path);
    }

    return "";
  }, [path]);

  useEffect(() => {
    if (!containerRef.current || !videoUrl) {
      return;
    }

    const player = new Artplayer({
      container: containerRef.current,
      url: videoUrl,
      setting: false,
      playbackRate: true,
      fullscreen: true,
      pip: true,
      miniProgressBar: true,
      backdrop: false,
      autoSize: true,
    });

    return () => {
      player.destroy(false);
    };
  }, [videoUrl]);

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="aspect-[16/8] w-full overflow-hidden rounded-[28px] bg-zinc-100 dark:bg-zinc-900"
      >
        {!videoUrl ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
            当前预览仅在 Tauri 桌面环境中加载本地视频
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {title}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{path}</p>
        </div>
        {onPlay ? (
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex items-center gap-2 self-start rounded-full bg-zinc-950 px-4 py-2 text-sm text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
          >
            <Play className="h-4 w-4" />
            播放
          </button>
        ) : null}
      </div>
    </div>
  );
}
