import type { PropsWithChildren, ReactNode } from "react";

interface SectionBlockProps extends PropsWithChildren {
  title: string;
  action?: ReactNode;
  description?: string;
}

export function SectionBlock({
  title,
  action,
  description,
  children,
}: SectionBlockProps) {
  return (
    <section className="space-y-5 border-b border-black/[0.06] pb-8 dark:border-white/10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
