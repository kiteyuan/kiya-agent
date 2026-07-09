import { create } from "zustand";

import { getInitialMessages, streamPiAgent } from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import { useDownloadStore } from "@/stores/download-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { ChatMessage } from "@/types/app";

interface ChatStore {
  draft: string;
  isSending: boolean;
  messages: ChatMessage[];
  setDraft: (value: string) => void;
  sendMessage: () => Promise<void>;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export const useChatStore = create<ChatStore>((set, get) => ({
  draft: "",
  isSending: false,
  messages: getInitialMessages(),
  setDraft: (value) => set({ draft: value }),
  sendMessage: async () => {
    const content = get().draft.trim();
    if (!content || get().isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: nowLabel(),
    };
    const assistantMessageId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: nowLabel(),
      streaming: true,
    };

    set((state) => ({
      draft: "",
      isSending: true,
      messages: [...state.messages, userMessage, assistantPlaceholder],
    }));

    try {
      const config = useAppStore.getState().config;
      await streamPiAgent(content, config, (event) => {
        if (event.stage === "text-delta" && event.delta) {
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: `${message.content}${event.delta}`,
                  }
                : message,
            ),
          }));
          return;
        }

        if (event.stage === "tool-call" && event.toolCall) {
          useDownloadStore.getState().registerToolCalls([event.toolCall]);
          usePlaylistStore.getState().registerToolCalls([event.toolCall]);

          set((state) => ({
            messages: [
              ...state.messages,
              {
                id: crypto.randomUUID(),
                role: "tool",
                content: `Pi Agent 调用了 ${event.toolCall.tool}`,
                timestamp: nowLabel(),
                toolCall: event.toolCall,
              },
            ],
          }));
          return;
        }

        if (event.stage === "complete") {
          set((state) => ({
            isSending: false,
            messages: state.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content:
                      event.assistantText?.trim() ||
                      message.content.trim() ||
                      "Pi Agent 已收到请求，但本轮没有返回可显示文本。",
                    streaming: false,
                  }
                : message,
            ),
          }));
        }
      });
    } catch (error) {
      set((state) => ({
        isSending: false,
        messages: state.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content:
                  error instanceof Error
                    ? error.message
                    : "Pi Agent 当前不可用，请检查模型与认证配置。",
                streaming: false,
              }
            : message,
        ),
      }));
    }
  },
}));
