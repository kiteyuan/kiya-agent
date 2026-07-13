import { create } from "zustand";

import {
  createChatConversation,
  deleteChatConversation,
  getInitialMessages,
  listChatConversations,
  loadChatMessages,
  normalizeDesktopError,
  saveChatMessages,
  streamPiAgent,
} from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import { useDownloadStore } from "@/stores/download-store";
import { useImageGalleryStore } from "@/stores/image-gallery-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { ChatConversationSummary, ChatMessage } from "@/types/app";

interface ChatStore {
  conversations: ChatConversationSummary[];
  currentConversationId: string | null;
  draft: string;
  hydrated: boolean;
  isSending: boolean;
  messages: ChatMessage[];
  hydrate: () => Promise<void>;
  createConversation: () => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  setDraft: (value: string) => void;
  sendMessage: () => Promise<void>;
}

function formatToolProgressMessage(message: ChatMessage) {
  const toolName = message.toolCall?.tool?.trim() || "MCP";
  return `正在调用 ${toolName}...`;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}

function upsertConversationSummary(
  conversations: ChatConversationSummary[],
  summary: ChatConversationSummary,
) {
  return [summary, ...conversations.filter((item) => item.id !== summary.id)].sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs,
  );
}

async function persistMessages(
  conversationId: string,
  messages: ChatMessage[],
) {
  try {
    return await saveChatMessages(conversationId, messages);
  } catch {
    return null;
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  draft: "",
  hydrated: false,
  isSending: false,
  messages: getInitialMessages(),
  hydrate: async () => {
    if (get().hydrated) {
      return;
    }

    let conversations = await listChatConversations();
    if (conversations.length === 0) {
      const firstConversation = await createChatConversation();
      conversations = [firstConversation];
    }

    const currentConversation = conversations[0];
    const persistedMessages = await loadChatMessages(currentConversation.id);

    set((state) => ({
      hydrated: true,
      conversations,
      currentConversationId: currentConversation.id,
      messages: state.messages.length === 0 ? persistedMessages : state.messages,
    }));
  },
  createConversation: async () => {
    if (get().isSending) {
      return;
    }

    const currentConversationId = get().currentConversationId;
    const currentConversation = get().conversations.find(
      (conversation) => conversation.id === currentConversationId,
    );
    if (
      currentConversationId &&
      currentConversation &&
      currentConversation.messageCount === 0 &&
      get().messages.length === 0
    ) {
      set(() => ({
        draft: "",
        messages: [],
      }));
      return;
    }

    const conversation = await createChatConversation();
    set((state) => ({
      conversations: upsertConversationSummary(state.conversations, conversation),
      currentConversationId: conversation.id,
      draft: "",
      messages: [],
    }));
  },
  deleteConversation: async (conversationId) => {
    if (get().isSending) {
      return;
    }

    const conversations = get().conversations;
    const existing = conversations.find((conversation) => conversation.id === conversationId);
    if (!existing) {
      return;
    }

    await deleteChatConversation(conversationId);

    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );

    if (get().currentConversationId !== conversationId) {
      set(() => ({
        conversations: remainingConversations,
      }));
      return;
    }

    if (remainingConversations.length === 0) {
      const conversation = await createChatConversation();
      set(() => ({
        conversations: [conversation],
        currentConversationId: conversation.id,
        draft: "",
        messages: [],
      }));
      return;
    }

    const nextConversation = remainingConversations[0];
    const messages = await loadChatMessages(nextConversation.id);
    set(() => ({
      conversations: remainingConversations,
      currentConversationId: nextConversation.id,
      draft: "",
      messages,
    }));
  },
  selectConversation: async (conversationId) => {
    if (
      get().isSending ||
      get().currentConversationId === conversationId
    ) {
      return;
    }

    const messages = await loadChatMessages(conversationId);
    set(() => ({
      currentConversationId: conversationId,
      draft: "",
      messages,
    }));
  },
  setDraft: (value) => set({ draft: value }),
  sendMessage: async () => {
    const content = get().draft.trim();
    const conversationId = get().currentConversationId;
    if (!content || get().isSending || !conversationId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: nowLabel(),
      createdAt: nowIso(),
    };
    const assistantMessageId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: nowLabel(),
      createdAt: nowIso(),
      streaming: true,
    };

    const historyMessages = get().messages;
    const nextMessages = [...historyMessages, userMessage, assistantPlaceholder];

    set(() => ({
      draft: "",
      isSending: true,
      messages: nextMessages,
    }));
    void persistMessages(conversationId, nextMessages).then((summary) => {
      if (!summary) {
        return;
      }

      set((state) => ({
        conversations: upsertConversationSummary(state.conversations, summary),
      }));
    });

    try {
      const config = useAppStore.getState().config;
      await streamPiAgent(content, config, historyMessages, (event) => {
        if (event.stage === "text-delta" && event.delta) {
          const nextDeltaMessages = get().messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: message.toolCall ? event.delta : `${message.content}${event.delta}`,
                    toolCall: undefined,
                  }
                : message,
            );

          set(() => ({
            messages: nextDeltaMessages,
          }));
          void persistMessages(conversationId, nextDeltaMessages).then((summary) => {
            if (!summary) {
              return;
            }

            set((state) => ({
              conversations: upsertConversationSummary(state.conversations, summary),
            }));
          });
          return;
        }

        if (event.stage === "tool-call" && event.toolCall) {
          useDownloadStore.getState().registerToolCalls([event.toolCall]);
          useImageGalleryStore.getState().registerToolCalls([event.toolCall]);
          usePlaylistStore.getState().registerToolCalls([event.toolCall]);

          const toolMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "tool",
            content: `Pi Agent 调用了 ${event.toolCall.tool}`,
            timestamp: nowLabel(),
            createdAt: nowIso(),
            toolCall: event.toolCall,
          };

          const nextToolMessages = [
            ...get().messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: formatToolProgressMessage(toolMessage),
                    toolCall: event.toolCall,
                  }
                : message,
            ),
            toolMessage,
          ];

          set(() => ({
            messages: nextToolMessages,
          }));
          void persistMessages(conversationId, nextToolMessages).then((summary) => {
            if (!summary) {
              return;
            }

            set((state) => ({
              conversations: upsertConversationSummary(state.conversations, summary),
            }));
          });
          return;
        }

        if (event.stage === "complete") {
          const completedMessages = get().messages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content:
                    event.assistantText?.trim() ||
                    message.content.trim() ||
                    "Pi Agent 已收到请求，但本轮没有返回可显示文本。",
                  toolCall: undefined,
                  streaming: false,
                }
              : message,
          );

          set(() => ({
            isSending: false,
            messages: completedMessages,
          }));
          void persistMessages(conversationId, completedMessages).then((summary) => {
            if (!summary) {
              return;
            }

            set((state) => ({
              conversations: upsertConversationSummary(state.conversations, summary),
            }));
          });
        }
      });
    } catch (error) {
      const failedMessages = get().messages.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: normalizeDesktopError(
                error,
                "Pi Agent 当前不可用，请检查模型与认证配置。",
              ),
              streaming: false,
            }
          : message,
      );

      set(() => ({
        isSending: false,
        messages: failedMessages,
      }));
      void persistMessages(conversationId, failedMessages).then((summary) => {
        if (!summary) {
          return;
        }

        set((state) => ({
          conversations: upsertConversationSummary(state.conversations, summary),
        }));
      });
    }
  },
}));
