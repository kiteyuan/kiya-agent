import Artplayer from "artplayer";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef } from "react";

interface PlayerSurfaceProps {
  path: string;
}

function isRemoteUrl(path: string) {
  return /^https?:\/\//i.test(path);
}

export function PlayerSurface({ path }: PlayerSurfaceProps) {
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
      autoSize: false,
    });

    return () => {
      player.destroy(false);
    };
  }, [videoUrl]);

  return (
    <div
      ref={containerRef}
      className="kiya-player-surface flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-black"
    >
      {!videoUrl ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-zinc-300">
          当前预览仅在 Tauri 桌面环境中加载本地视频
        </div>
      ) : null}
    </div>
  );
}
