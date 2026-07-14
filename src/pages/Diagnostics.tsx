import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { normalizeDesktopError, readAppStatusDetails } from "@/services/desktop";
import { useAppStore } from "@/stores/app-store";
import type { AppStatusPayload } from "@/types/app";

function splitLogs(logs: string[]) {
  return {
    piLogs: logs.filter((log) => log.startsWith("[pi")),
    bootstrapLogs: logs.filter((log) => !log.startsWith("[pi")),
  };
}

function formatTimestamp(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function DiagnosticsPage() {
  const { t, locale } = useI18n();
  const fallbackLogs = useAppStore((state) => state.logs);
  const fallbackGroups = useMemo(() => splitLogs(fallbackLogs), [fallbackLogs]);
  const [payload, setPayload] = useState<AppStatusPayload | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const nextPayload = await readAppStatusDetails();
      setPayload(nextPayload);
      setLastUpdated(new Date());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeDesktopError(error, "刷新诊断失败"));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const piLogs = payload?.piLogs ?? fallbackGroups.piLogs;
  const bootstrapLogs = payload?.bootstrapLogs ?? fallbackGroups.bootstrapLogs;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[920px] space-y-4 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {t("diagnostics.title")}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {t("diagnostics.description")}
            </p>
            {lastUpdated ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("diagnostics.lastUpdated", {
                  value: formatTimestamp(lastUpdated, locale),
                })}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void refreshDiagnostics()}
            disabled={isRefreshing}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-sm text-zinc-700 transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-white/[0.04]"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            <span>
              {isRefreshing ? t("diagnostics.refreshing") : t("diagnostics.refresh")}
            </span>
          </button>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            {t("diagnostics.loadFailed", { message: errorMessage })}
          </div>
        ) : null}

        <LogSection
          title={t("diagnostics.piLogs")}
          logs={piLogs}
          countLabel={t("diagnostics.lines", { count: piLogs.length })}
          emptyLabel={t("diagnostics.empty")}
        />

        <LogSection
          title={t("diagnostics.bootstrapLogs")}
          logs={bootstrapLogs}
          countLabel={t("diagnostics.lines", { count: bootstrapLogs.length })}
          emptyLabel={t("diagnostics.empty")}
        />
      </div>
    </div>
  );
}

function LogSection({
  title,
  logs,
  countLabel,
  emptyLabel,
}: {
  title: string;
  logs: string[];
  countLabel: string;
  emptyLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</h2>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{countLabel}</span>
      </div>

      <div className="max-h-[360px] overflow-auto bg-black px-4 py-4">
        {logs.length > 0 ? (
          <div className="space-y-2">
            {logs.map((log, index) => (
              <div
                key={`${title}-${index}-${log}`}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 font-mono text-xs leading-6"
              >
                <span className="select-none text-zinc-500">{index + 1}</span>
                <p className="whitespace-pre-wrap break-all text-zinc-300">{log}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs leading-6 text-zinc-500">{emptyLabel}</p>
        )}
      </div>
    </section>
  );
}
