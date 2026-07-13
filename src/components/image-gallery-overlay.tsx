import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useImageGalleryStore } from "@/stores/image-gallery-store";

function resolveImageUrl(source: string) {
  if (!source) {
    return "";
  }

  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  if (isTauri()) {
    return convertFileSrc(source);
  }

  return "";
}

export function ImageGalleryOverlay() {
  const activeGallery = useImageGalleryStore((state) => state.activeGallery);
  const closeGallery = useImageGalleryStore((state) => state.closeGallery);
  const showPrevious = useImageGalleryStore((state) => state.showPrevious);
  const showNext = useImageGalleryStore((state) => state.showNext);

  const activeImage = activeGallery?.images[activeGallery.activeIndex] ?? null;
  const imageUrl = useMemo(
    () => resolveImageUrl(activeImage?.source ?? ""),
    [activeImage?.source],
  );
  const hasMultipleImages = (activeGallery?.images.length ?? 0) > 1;

  useEffect(() => {
    if (!activeGallery) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeGallery();
        return;
      }

      if (event.key === "ArrowLeft") {
        showPrevious();
        return;
      }

      if (event.key === "ArrowRight") {
        showNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeGallery, closeGallery, showNext, showPrevious]);

  if (!activeGallery || !activeImage) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80">
      <button
        type="button"
        onClick={closeGallery}
        className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
        aria-label="关闭图片预览"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex h-full items-center justify-center p-8 md:p-10">
        <div className="relative flex h-full max-h-[calc(100vh-11rem)] w-full max-w-[960px] items-center justify-center">
          {hasMultipleImages ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                aria-label="上一张"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={showNext}
                className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                aria-label="下一张"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}

          {imageUrl ? (
            <div className="flex h-full w-full items-center justify-center px-10 py-6">
              <img
                src={imageUrl}
                alt={activeImage.title}
                className="h-full w-full select-none object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-sm text-zinc-300">
              当前预览仅在 Tauri 桌面环境中加载本地图片
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
