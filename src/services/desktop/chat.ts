import { invoke } from "@tauri-apps/api/core";

import type { ChatConversationSummary, ChatMessage } from "@/types/app";

import {
  CHAT_CONVERSATIONS_STORE_KEY,
  CHAT_MESSAGES_STORE_KEY,
  isTauriRuntime,
} from "./runtime";

export function getInitialMessages(): ChatMessage[] {
  return [];
}

export async function listChatConversations(): Promise<
  ChatConversationSummary[]
> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary[]>("list_chat_conversations");
  }

  const rawConversations = localStorage.getItem(CHAT_CONVERSATIONS_STORE_KEY);
  if (!rawConversations) {
    return [];
  }

  try {
    return (
      JSON.parse(rawConversations) as Array<Partial<ChatConversationSummary>>
    ).map((conversation) => ({
      id: conversation.id ?? crypto.randomUUID(),
      title: conversation.title ?? "新会话",
      createdAtMs: conversation.createdAtMs ?? Date.now(),
      updatedAtMs:
        conversation.updatedAtMs ?? conversation.createdAtMs ?? Date.now(),
      messageCount: conversation.messageCount ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function createChatConversation(): Promise<ChatConversationSummary> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary>("create_chat_conversation");
  }

  const now = Date.now();
  const conversation: ChatConversationSummary = {
    id: crypto.randomUUID(),
    title: "新会话",
    createdAtMs: now,
    updatedAtMs: now,
    messageCount: 0,
  };
  const conversations = await listChatConversations();
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify([conversation, ...conversations]),
  );
  return conversation;
}

export async function deleteChatConversation(
  conversationId: string,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("delete_chat_conversation", {
      conversationId,
    });
    return;
  }

  const conversations = await listChatConversations();
  const nextConversations = conversations.filter(
    (item) => item.id !== conversationId,
  );
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify(nextConversations),
  );

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  if (!rawMessages) {
    return;
  }

  try {
    const messageMap = JSON.parse(rawMessages) as Record<string, ChatMessage[]>;
    delete messageMap[conversationId];
    localStorage.setItem(CHAT_MESSAGES_STORE_KEY, JSON.stringify(messageMap));
  } catch {
    localStorage.removeItem(CHAT_MESSAGES_STORE_KEY);
  }
}

export async function loadChatMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  if (isTauriRuntime()) {
    return invoke<ChatMessage[]>("load_chat_messages", {
      conversationId,
    });
  }

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  if (!rawMessages) {
    return [];
  }

  try {
    const messageMap = JSON.parse(rawMessages) as Record<string, ChatMessage[]>;
    return messageMap[conversationId] ?? [];
  } catch {
    return [];
  }
}

export async function saveChatMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<ChatConversationSummary> {
  if (isTauriRuntime()) {
    return invoke<ChatConversationSummary>("save_chat_messages", {
      conversationId,
      messages,
    });
  }

  const rawMessages = localStorage.getItem(CHAT_MESSAGES_STORE_KEY);
  const messageMap = rawMessages
    ? (JSON.parse(rawMessages) as Record<string, ChatMessage[]>)
    : {};
  messageMap[conversationId] = messages;
  localStorage.setItem(CHAT_MESSAGES_STORE_KEY, JSON.stringify(messageMap));

  const conversations = await listChatConversations();
  const now = Date.now();
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const title = firstUserMessage?.content.trim().slice(0, 40) || "新会话";
  const existing = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const summary: ChatConversationSummary = {
    id: conversationId,
    title,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    messageCount: messages.length,
  };
  const nextConversations = [
    summary,
    ...conversations.filter((item) => item.id !== conversationId),
  ].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  localStorage.setItem(
    CHAT_CONVERSATIONS_STORE_KEY,
    JSON.stringify(nextConversations),
  );
  return summary;
}
