import { create } from "zustand";

import { getInitialPlaylist } from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import type { PlaylistItem, ToolCallSummary } from "@/types/app";

interface PlaylistStore {
  items: PlaylistItem[];
  activeItem: PlaylistItem | null;
  registerToolCalls: (toolCalls: ToolCallSummary[]) => void;
  openItem: (item: PlaylistItem) => void;
  openSource: (source: string, options?: { title?: string; origin?: PlaylistItem["origin"] }) => PlaylistItem | null;
  closeActiveItem: () => void;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
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

function deriveTitle(source: string) {
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split("/").pop();
    return filename && filename.trim()
      ? decodeURIComponent(filename)
      : "未命名视频";
  } catch {
    const normalized = source.split(/[\\/]/).pop();
    return normalized && normalized.trim() ? normalized : "未命名视频";
  }
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function createPlaylistItem(
  source: string,
  options?: { title?: string; origin?: PlaylistItem["origin"] },
) {
  return {
    id: crypto.randomUUID(),
    title: options?.title?.trim() || deriveTitle(source),
    source,
    kind: isRemoteUrl(source) ? "remote-url" : "local-file",
    origin: options?.origin ?? "manual",
    addedAt: nowLabel(),
  } satisfies PlaylistItem;
}

export const usePlaylistStore = create<PlaylistStore>((set) => ({
  items: getInitialPlaylist(useAppStore.getState().config.downloadDir),
  activeItem: null,
  registerToolCalls: (toolCalls) => {
    const candidates = toolCalls
      .filter((toolCall) => toolCall.tool === "play_video")
      .map((toolCall) => {
        const payload = parseToolCallDetail(toolCall.detail);
        if (!payload) {
          return null;
        }

        const sourceValue =
          typeof payload.url === "string" && payload.url.trim()
            ? payload.url.trim()
            : typeof payload.filePath === "string" && payload.filePath.trim()
              ? payload.filePath.trim()
              : null;

        if (!sourceValue) {
          return null;
        }

        return {
          source: sourceValue,
          title: typeof payload.title === "string" ? payload.title : undefined,
          origin: "tool-call",
        } as const;
      })
      .filter((item) => item !== null);

    if (candidates.length === 0) {
      return;
    }

    set((state) => {
      const merged = [...state.items];
      let activeItem = state.activeItem;

      for (const candidate of candidates) {
        const existingItem = merged.find((item) => item.source === candidate.source);
        const resolvedItem =
          existingItem ?? createPlaylistItem(candidate.source, candidate);

        if (!existingItem) {
          merged.unshift(resolvedItem);
        }

        activeItem = resolvedItem;
      }

      return {
        items: merged,
        activeItem,
      };
    });
  },
  openItem: (item) => {
    set({
      activeItem: item,
    });
  },
  openSource: (source, options) => {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      return null;
    }

    let resolvedItem: PlaylistItem | null = null;
    set((state) => {
      const existingItem = state.items.find((item) => item.source === normalizedSource);
      resolvedItem =
        existingItem ?? createPlaylistItem(normalizedSource, options);

      return {
        items: existingItem ? state.items : [resolvedItem, ...state.items],
        activeItem: resolvedItem,
      };
    });

    return resolvedItem;
  },
  closeActiveItem: () => {
    set({
      activeItem: null,
    });
  },
}));
