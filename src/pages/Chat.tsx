import { Send } from "lucide-react";

import { MessageItem } from "@/components/message-item";
import { useChatStore } from "@/stores/chat-store";

export default function ChatPage() {
  const messages = useChatStore((state) => state.messages);
  const draft = useChatStore((state) => state.draft);
  const isSending = useChatStore((state) => state.isSending);
  const setDraft = useChatStore((state) => state.setDraft);
  const sendMessage = useChatStore((state) => state.sendMessage);

  return (
    <div className="relative flex h-full min-h-0 flex-col px-3 py-3">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-4 pb-24">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3">
        <div className="pointer-events-auto w-full rounded-[18px] bg-white/90 px-3 py-2 dark:bg-zinc-950/85">
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
            placeholder="输入消息"
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
      </div>
    </div>
  );
}
