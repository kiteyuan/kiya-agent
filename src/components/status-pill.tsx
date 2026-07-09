import { cn } from "@/lib/utils";
import type { ServiceState } from "@/types/app";

interface StatusPillProps {
  label: string;
  state: ServiceState | "missing" | "generated";
}

const stateClassName: Record<StatusPillProps["state"], string> = {
  starting: "text-zinc-500",
  ready: "text-emerald-600",
  error: "text-red-600",
  missing: "text-zinc-500",
  generated: "text-emerald-600",
};

export function StatusPill({ label, state }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap text-xs tracking-wide",
        stateClassName[state],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </span>
  );
}
