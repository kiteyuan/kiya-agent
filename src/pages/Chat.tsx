import { useLayoutEffect, useRef } from "react";
import { Send } from "lucide-react";

import { MessageItem } from "@/components/message-item";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@/types/app";

const TIME_DIVIDER_GAP_MS = 15 * 60 * 1000;
const CHAT_CONTENT_MAX_WIDTH = "min(920px, calc(100vw - 32px))";
const AUTO_SCROLL_THRESHOLD = 80;
const USER_MESSAGE_VIEWPORT_OFFSET = 0.38;

function parseMessageTime(message: ChatMessage) {
  if (!message.createdAt) {
    return null;
  }

  const time = new Date(message.createdAt);
  if (Number.isNaN(time.getTime())) {
    return null;
  }

  return time;
}

function shouldShowTimeDivider(
  previousMessage: ChatMessage | undefined,
  currentMessage: ChatMessage,
) {
  if (!previousMessage) {
    return false;
  }

  const previousTime = parseMessageTime(previousMessage);
  const currentTime = parseMessageTime(currentMessage);

  if (!previousTime || !currentTime) {
    return false;
  }

  return currentTime.getTime() - previousTime.getTime() >= TIME_DIVIDER_GAP_MS;
}

function formatDividerLabel(message: ChatMessage) {
  const time = parseMessageTime(message);
  if (!time) {
    return message.timestamp;
  }

  const now = new Date();
  const isSameDay =
    time.getFullYear() === now.getFullYear() &&
    time.getMonth() === now.getMonth() &&
    time.getDate() === now.getDate();

  return new Intl.DateTimeFormat("zh-CN", {
    month: isSameDay ? undefined : "numeric",
    day: isSameDay ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
}

function isNearBottom(element: HTMLDivElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_THRESHOLD
  );
}

export default function ChatPage() {
  const messages = useChatStore((state) => state.messages);
  const draft = useChatStore((state) => state.draft);
  const isSending = useChatStore((state) => state.isSending);
  const setDraft = useChatStore((state) => state.setDraft);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const visibleMessages = messages.filter((message) => message.role !== "tool");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const reserveReplySpaceRef = useRef(false);
  const lastHandledSendRef = useRef<string | null>(null);
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const lastUserMessage = [...visibleMessages]
    .reverse()
    .find((message) => message.role === "user");
  const isEmptyConversation = visibleMessages.length === 0;
  const shouldReserveReplySpace =
    isSending &&
    visibleMessages.length <= 2 &&
    visibleMessages.every(
      (message) => message.role === "user" || message.role === "assistant",
    ) &&
    lastUserMessage?.id !== undefined;

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !bottomAnchorRef.current) {
      return;
    }

    if (
      shouldReserveReplySpace &&
      lastUserMessage &&
      lastUserMessageRef.current &&
      lastHandledSendRef.current !== lastUserMessage.id
    ) {
      const targetTop =
        lastUserMessageRef.current.offsetTop -
        scrollContainer.clientHeight * USER_MESSAGE_VIEWPORT_OFFSET;
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
      });
      reserveReplySpaceRef.current = true;
      lastHandledSendRef.current = lastUserMessage.id;
      return;
    }

    if (reserveReplySpaceRef.current && isSending) {
      return;
    }

    reserveReplySpaceRef.current = false;

    if (shouldFollowRef.current) {
      bottomAnchorRef.current.scrollIntoView({ block: "end" });
    }
  }, [
    visibleMessages.length,
    lastVisibleMessage?.content,
    isSending,
    lastUserMessage,
    shouldReserveReplySpace,
  ]);

  const composer = (
    <div className="w-full rounded-[18px] border border-black/[0.06] bg-[var(--app-panel)] px-3 py-2 dark:border-white/10">
      <div className="flex items-center gap-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }

            if (
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.nativeEvent.isComposing
            ) {
              return;
            }

            event.preventDefault();
            void sendMessage();
          }}
          placeholder="想聊点什么？"
          className="h-9 w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
          disabled={!draft.trim() || isSending}
          aria-label={isSending ? "生成中" : "发送"}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col py-3">
      {isEmptyConversation ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <div
            className="mx-auto flex w-full flex-col items-center gap-6 text-center"
            style={{ width: CHAT_CONTENT_MAX_WIDTH }}
          >
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                你好，我是 Kiya Agent
              </h1>
              <p className="text-sm leading-7 text-zinc-500 dark:text-zinc-400">
                今天想处理什么？可以直接问我下载、播放、MCP 或配置相关的问题。
              </p>
            </div>
            {composer}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollContainerRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(event) => {
              shouldFollowRef.current = isNearBottom(event.currentTarget);
            }}
          >
            <div
              className="mx-auto flex min-h-full flex-col gap-4 px-4 pb-24"
              style={{ width: CHAT_CONTENT_MAX_WIDTH }}
            >
              {visibleMessages.map((message, index) => (
                <div
                  key={message.id}
                  ref={message.id === lastUserMessage?.id ? lastUserMessageRef : null}
                  className="space-y-4"
                >
                  {shouldShowTimeDivider(visibleMessages[index - 1], message) ? (
                    <div className="flex items-center gap-3 py-1 text-xs text-zinc-400 dark:text-zinc-500">
                      <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/10" />
                      <span className="shrink-0">{formatDividerLabel(message)}</span>
                      <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/10" />
                    </div>
                  ) : null}
                  <MessageItem message={message} />
                </div>
              ))}
              <div ref={bottomAnchorRef} />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-3">
            <div
              className="pointer-events-auto mx-auto px-4"
              style={{ width: CHAT_CONTENT_MAX_WIDTH }}
            >
              {composer}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
