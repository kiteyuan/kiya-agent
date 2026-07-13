import { create } from "zustand";

import {
  listPlaylistHistory,
  savePlaylistHistory,
} from "@/services/desktop";
import { getIntlLocale } from "@/i18n";
import { useAppStore } from "@/stores/app-store";
import type { PlaylistItem, ToolCallSummary } from "@/types/app";

interface PlaylistStore {
  hydrated: boolean;
  items: PlaylistItem[];
  activeItem: PlaylistItem | null;
  unreadCount: number;
  hydrate: () => Promise<void>;
  clearHistory: () => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  markAllSeen: () => void;
  registerToolCalls: (toolCalls: ToolCallSummary[]) => void;
  openItem: (item: PlaylistItem) => void;
  openSource: (source: string, options?: { title?: string; origin?: PlaylistItem["origin"] }) => PlaylistItem | null;
  closeActiveItem: () => void;
}

function nowLabel() {
  const language = useAppStore.getState().config.language;
  return new Intl.DateTimeFormat(getIntlLocale(language), {
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

function deriveTitle(source: string) {
  const fallbackTitle =
    useAppStore.getState().config.language === "en" ? "Untitled video" : "未命名视频";
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split("/").pop();
    return filename && filename.trim()
      ? decodeURIComponent(filename)
      : fallbackTitle;
  } catch {
    const normalized = source.split(/[\\/]/).pop();
    return normalized && normalized.trim() ? normalized : fallbackTitle;
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

function resolveItemTitle(currentTitle: string, source: string, nextTitle?: string) {
  const trimmedNextTitle = nextTitle?.trim();
  if (!trimmedNextTitle) {
    return currentTitle;
  }

  const fallbackTitle = deriveTitle(source);
  if (currentTitle === fallbackTitle || currentTitle === "未命名视频" || currentTitle === "Untitled video") {
    return trimmedNextTitle;
  }

  return currentTitle;
}

async function persistItems(items: PlaylistItem[]) {
  try {
    await savePlaylistHistory(items);
  } catch {
    return;
  }
}

export const usePlaylistStore = create<PlaylistStore>((set) => ({
  hydrated: false,
  items: [],
  activeItem: null,
  unreadCount: 0,
  hydrate: async () => {
    const state = usePlaylistStore.getState();
    if (state.hydrated) {
      return;
    }

    const items = await listPlaylistHistory();
    set(() => ({
      hydrated: true,
      items,
    }));
  },
  clearHistory: async () => {
    set(() => ({
      items: [],
      activeItem: null,
      unreadCount: 0,
    }));
    await persistItems([]);
  },
  removeItem: async (id) => {
    const state = usePlaylistStore.getState();
    const nextItems = state.items.filter((item) => item.id !== id);
    if (nextItems.length === state.items.length) {
      return;
    }

    set(() => ({
      items: nextItems,
      activeItem: state.activeItem?.id === id ? null : state.activeItem,
    }));
    await persistItems(nextItems);
  },
  markAllSeen: () => {
    const state = usePlaylistStore.getState();
    if (state.unreadCount === 0) {
      return;
    }

    set(() => ({
      unreadCount: 0,
    }));
  },
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

    const state = usePlaylistStore.getState();
    const merged = [...state.items];
    let activeItem = state.activeItem;
    let addedCount = 0;

    for (const candidate of candidates) {
      const existingIndex = merged.findIndex((item) => item.source === candidate.source);
      const existingItem = existingIndex === -1 ? null : merged[existingIndex];
      let resolvedItem =
        existingItem ?? createPlaylistItem(candidate.source, candidate);

      if (!existingItem) {
        merged.unshift(resolvedItem);
        addedCount += 1;
      } else {
        const resolvedTitle = resolveItemTitle(
          existingItem.title,
          candidate.source,
          candidate.title,
        );

        if (resolvedTitle !== existingItem.title) {
          resolvedItem = {
            ...existingItem,
            title: resolvedTitle,
          };
          merged[existingIndex] = resolvedItem;
        }
      }

      activeItem = resolvedItem;
    }

    set(() => ({
      items: merged,
      activeItem,
      unreadCount: state.unreadCount + addedCount,
    }));
    void persistItems(merged);
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
    const state = usePlaylistStore.getState();
    const existingItem = state.items.find((item) => item.source === normalizedSource);
    resolvedItem =
      existingItem ?? createPlaylistItem(normalizedSource, options);

    if (existingItem) {
      const resolvedTitle = resolveItemTitle(
        existingItem.title,
        normalizedSource,
        options?.title,
      );
      if (resolvedTitle !== existingItem.title) {
        resolvedItem = {
          ...existingItem,
          title: resolvedTitle,
        };
      }
    }

    const nextItems = existingItem
      ? state.items.map((item) =>
          item.source === normalizedSource ? resolvedItem : item,
        )
      : [resolvedItem, ...state.items];

    set(() => ({
      items: nextItems,
      activeItem: resolvedItem,
      unreadCount: state.unreadCount + (existingItem ? 0 : 1),
    }));
    void persistItems(nextItems);

    return resolvedItem;
  },
  closeActiveItem: () => {
    set({
      activeItem: null,
    });
  },
}));
