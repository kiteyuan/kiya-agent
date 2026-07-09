import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/app";

interface MessageItemProps {
  message: ChatMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool && message.toolCall) {
    return (
      <article className="max-w-[72%] rounded-[22px] bg-amber-50/70 px-4 py-3 text-zinc-900 dark:bg-amber-500/10 dark:text-zinc-100">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm marker:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180 dark:text-zinc-500" />
              <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                {message.toolCall.tool}
              </div>
            </div>
            <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
              {message.timestamp}
            </div>
          </summary>

          <div className="mt-3 rounded-[16px] bg-black/[0.03] p-3 text-xs leading-6 text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
            <div className="mb-2 uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
              {message.toolCall.tool}
            </div>
            <p className="whitespace-pre-wrap break-all">{message.toolCall.detail}</p>
          </div>
        </details>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "max-w-[88%] space-y-3 rounded-[28px] px-5 py-4",
        isUser &&
          "ml-auto bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950",
        isTool &&
          "bg-amber-50/80 text-zinc-900 dark:bg-amber-500/10 dark:text-zinc-100",
        !isUser &&
          !isTool &&
          "bg-white/70 text-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-100",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-4 text-xs tracking-wide",
          isUser
            ? "text-white/65 dark:text-zinc-600"
            : "text-zinc-500 dark:text-zinc-400",
        )}
      >
        <span>
          {isUser ? "你" : isTool ? "Tool" : "Kiya Agent"}
        </span>
        <span>{message.timestamp}</span>
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap text-sm leading-7",
          isUser
            ? "text-white dark:text-zinc-950"
            : "text-zinc-800 dark:text-zinc-100",
        )}
      >
        {message.content || (message.streaming ? "正在生成..." : "")}
      </p>
      {message.toolCall ? (
        <div
          className={cn(
            "text-xs leading-6",
            isUser
              ? "text-white/70 dark:text-zinc-700"
              : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          <span className="mr-3 uppercase tracking-[0.18em]">
            {message.toolCall.tool}
          </span>
          <span>{message.toolCall.detail}</span>
        </div>
      ) : null}
    </article>
  );
}
