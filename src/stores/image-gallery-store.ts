import { create } from "zustand";

import type {
  ImageGalleryImage,
  ImageGalleryPresentation,
  ToolCallSummary,
} from "@/types/app";

interface ImageGalleryStore {
  activeGallery: ImageGalleryPresentation | null;
  registerToolCalls: (toolCalls: ToolCallSummary[]) => void;
  openGallery: (gallery: ImageGalleryPresentation) => void;
  closeGallery: () => void;
  showPrevious: () => void;
  showNext: () => void;
  setActiveIndex: (index: number) => void;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function parseToolCallDetail(detail: string) {
  const separatorIndex = detail.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const payload = detail.slice(separatorIndex + 1).trim();
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function deriveTitle(source: string) {
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split("/").pop();
    return filename && filename.trim()
      ? decodeURIComponent(filename)
      : "未命名图片";
  } catch {
    const normalized = source.split(/[\\/]/).pop();
    return normalized && normalized.trim() ? normalized : "未命名图片";
  }
}

function normalizeImageSource(raw: unknown) {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed || null;
}

function normalizeImageList(payload: Record<string, unknown>) {
  const images = Array.isArray(payload.images)
    ? payload.images
        .map(normalizeImageSource)
        .filter((value): value is string => value !== null)
    : [];

  if (images.length > 0) {
    return images;
  }

  const fallbackCandidates = [
    payload.url,
    payload.filePath,
    ...(Array.isArray(payload.urls) ? payload.urls : []),
    ...(Array.isArray(payload.filePaths) ? payload.filePaths : []),
  ];

  return fallbackCandidates
    .map(normalizeImageSource)
    .filter((value): value is string => value !== null);
}

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= length) {
    return length - 1;
  }

  return index;
}

function buildGallery(
  payload: Record<string, unknown>,
): ImageGalleryPresentation | null {
  const sources = normalizeImageList(payload);
  if (sources.length === 0) {
    return null;
  }

  const images: ImageGalleryImage[] = sources.map((source) => ({
    id: crypto.randomUUID(),
    source,
    title: deriveTitle(source),
    kind: isRemoteUrl(source) ? "remote-url" : "local-file",
  }));

  const requestedStartIndex =
    typeof payload.startIndex === "number" ? payload.startIndex : 0;
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : images.length === 1
        ? images[0].title
        : "图片预览";

  return {
    id: crypto.randomUUID(),
    title,
    images,
    activeIndex: clampIndex(Math.floor(requestedStartIndex), images.length),
    origin: "tool-call",
    addedAt: nowLabel(),
  };
}

function moveIndex(currentIndex: number, total: number, delta: number) {
  if (total <= 0) {
    return 0;
  }

  return (currentIndex + delta + total) % total;
}

export const useImageGalleryStore = create<ImageGalleryStore>((set, get) => ({
  activeGallery: null,
  registerToolCalls: (toolCalls) => {
    const nextGallery = toolCalls
      .filter((toolCall) => toolCall.tool === "show_images")
      .map((toolCall) => parseToolCallDetail(toolCall.detail))
      .map((payload) => (payload ? buildGallery(payload) : null))
      .filter((gallery): gallery is ImageGalleryPresentation => gallery !== null)
      .at(-1);

    if (!nextGallery) {
      return;
    }

    set(() => ({
      activeGallery: nextGallery,
    }));
  },
  openGallery: (gallery) => {
    set(() => ({
      activeGallery: gallery,
    }));
  },
  closeGallery: () => {
    set(() => ({
      activeGallery: null,
    }));
  },
  showPrevious: () => {
    const activeGallery = get().activeGallery;
    if (!activeGallery) {
      return;
    }

    set(() => ({
      activeGallery: {
        ...activeGallery,
        activeIndex: moveIndex(activeGallery.activeIndex, activeGallery.images.length, -1),
      },
    }));
  },
  showNext: () => {
    const activeGallery = get().activeGallery;
    if (!activeGallery) {
      return;
    }

    set(() => ({
      activeGallery: {
        ...activeGallery,
        activeIndex: moveIndex(activeGallery.activeIndex, activeGallery.images.length, 1),
      },
    }));
  },
  setActiveIndex: (index) => {
    const activeGallery = get().activeGallery;
    if (!activeGallery) {
      return;
    }

    set(() => ({
      activeGallery: {
        ...activeGallery,
        activeIndex: clampIndex(index, activeGallery.images.length),
      },
    }));
  },
}));
