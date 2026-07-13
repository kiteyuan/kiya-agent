import { ChevronDown, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/app";

interface MessageItemProps {
  message: ChatMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isToolProgress =
    message.role === "assistant" &&
    Boolean(message.toolCall) &&
    message.streaming !== false;

  if (isTool && message.toolCall) {
    return (
      <article className="max-w-[72%] rounded-[22px] bg-amber-50/70 px-4 py-3 text-zinc-900 dark:bg-amber-500/10 dark:text-zinc-100">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-4 text-sm marker:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180 dark:text-zinc-500" />
              <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                {message.toolCall.tool}
              </div>
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
        "space-y-2",
        isUser
          ? "ml-auto w-fit max-w-[80%] self-end rounded-[18px] bg-zinc-950 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-950"
          : isTool
            ? "max-w-[88%] rounded-[22px] bg-amber-50/80 px-4 py-3 text-zinc-900 dark:bg-amber-500/10 dark:text-zinc-100"
            : "max-w-none px-1 py-1 text-zinc-900 dark:text-zinc-100",
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-white dark:text-zinc-950">
          {message.content || (message.streaming ? t("chat.generating") : "")}
        </p>
      ) : isToolProgress ? (
        <div className="flex items-center gap-2 text-sm leading-7 text-zinc-900 dark:text-zinc-100">
          <span>{message.content}</span>
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-zinc-500 dark:text-zinc-400" />
        </div>
      ) : (
        <div className="prose prose-zinc max-w-none break-words text-sm leading-7 prose-headings:mb-3 prose-headings:mt-6 prose-headings:font-semibold prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-blockquote:text-zinc-600 prose-pre:rounded-2xl prose-pre:border prose-pre:border-black/[0.06] prose-pre:bg-black/[0.03] prose-pre:text-zinc-800 prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:p-0 prose-pre:[&_code]:text-inherit prose-code:rounded prose-code:bg-black/[0.04] prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none dark:prose-invert dark:prose-blockquote:text-zinc-300 dark:prose-pre:border-white/10 dark:prose-pre:bg-white/[0.04] dark:prose-pre:text-zinc-100 dark:prose-code:bg-white/[0.08]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || (message.streaming ? t("chat.generating") : "")}
          </ReactMarkdown>
        </div>
      )}
      {isTool && message.toolCall ? (
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
