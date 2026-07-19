import { invoke, isTauri } from "@tauri-apps/api/core";

function truncate(value: string, max = 4000) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

async function report(source: string, message: string) {
  if (!isTauri()) {
    return;
  }

  try {
    await invoke("report_client_error", {
      source,
      message: truncate(message),
    });
  } catch {
    // Avoid recursive reporting loops when the desktop bridge is unavailable.
  }
}

export function installClientErrorReporting() {
  if (typeof window === "undefined" || !isTauri()) {
    return;
  }

  window.addEventListener("error", (event) => {
    const details = [
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
      event.error instanceof Error ? event.error.stack ?? "" : "",
    ]
      .filter(Boolean)
      .join(" | ");
    void report("window.error", details || "unknown error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const details =
      reason instanceof Error
        ? `${reason.message}${reason.stack ? ` | ${reason.stack}` : ""}`
        : String(reason);
    void report("unhandledrejection", details || "unknown rejection");
  });
}
