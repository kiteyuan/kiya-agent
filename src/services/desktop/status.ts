import { invoke } from "@tauri-apps/api/core";

import type {
  AppBootstrapStatus,
  AppStatusPayload,
  RuntimeDefaults,
} from "@/types/app";

import { defaultBootstrapStatus } from "./defaults";
import { isTauriRuntime, previewRuntimeDefaults } from "./runtime";

export function mergeBootstrapStatus(
  overrides?: Partial<AppBootstrapStatus>,
): AppBootstrapStatus {
  return {
    ...defaultBootstrapStatus,
    ...overrides,
  };
}

export async function bootstrapServices(): Promise<AppBootstrapStatus> {
  if (isTauriRuntime()) {
    const payload = await invoke<AppStatusPayload>("read_app_status");
    return payload.status;
  }

  return mergeBootstrapStatus();
}

export async function readAppStatusDetails(): Promise<AppStatusPayload> {
  if (isTauriRuntime()) {
    return invoke<AppStatusPayload>("read_app_status");
  }

  return {
    status: mergeBootstrapStatus(),
    logs: [
      "[bootstrap] aria2 ready",
      "[bootstrap] local mcp ready",
      "[pi] preview mode fallback",
    ],
    bootstrapLogs: ["[bootstrap] aria2 ready", "[bootstrap] local mcp ready"],
    piLogs: ["[pi] preview mode fallback"],
  };
}

export async function readRuntimeDefaults(): Promise<RuntimeDefaults> {
  if (isTauriRuntime()) {
    return invoke<RuntimeDefaults>("read_runtime_defaults");
  }

  return previewRuntimeDefaults;
}
