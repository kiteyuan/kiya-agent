import { useAppStore } from "@/stores/app-store";

export default function DiagnosticsPage() {
  const logs = useAppStore((state) => state.logs);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[920px] pb-10">
        <div className="rounded-2xl border border-black bg-black px-4 py-4 text-zinc-100 dark:border-white/10">
          <div className="space-y-3">
            {logs.map((log, index) => (
              <p
                key={`${index}-${log}`}
                className="font-mono text-xs leading-6 text-zinc-300"
              >
                {log}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
