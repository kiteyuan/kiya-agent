import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Stabilize Tauri/cargo builds on Windows, especially when the repo path
 * contains spaces (e.g. "Base Projects"). Absolute paths baked into the
 * default in-tree target/ cache frequently break permission codegen.
 */
const projectRoot = path.resolve(import.meta.dirname, "..");
const localTempDir = path.join(projectRoot, ".tmp", "tauri-build");

const separatorIndex = process.argv.indexOf("--");
const commandArgs =
  separatorIndex >= 0
    ? process.argv.slice(separatorIndex + 1)
    : process.argv.slice(2);

if (commandArgs.length === 0) {
  console.error("[with-stable-build-env] missing command after --");
  process.exit(1);
}

function resolveStableCargoTargetDir() {
  if (process.env.CARGO_TARGET_DIR?.trim()) {
    return path.resolve(process.env.CARGO_TARGET_DIR.trim());
  }

  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "kiya-agent", "cargo-target");
  }

  const base =
    process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
  return path.join(base, "kiya-agent", "cargo-target");
}

const projectHasSpaces = /\s/.test(projectRoot);
const cargoTargetDir = resolveStableCargoTargetDir();

fs.mkdirSync(localTempDir, { recursive: true });
fs.mkdirSync(cargoTargetDir, { recursive: true });

if (projectHasSpaces) {
  console.warn(
    `[with-stable-build-env] project path contains spaces:\n  ${projectRoot}`,
  );
  console.warn(
    `[with-stable-build-env] using stable CARGO_TARGET_DIR:\n  ${cargoTargetDir}`,
  );
  console.warn(
    "[with-stable-build-env] long-term recommendation: clone/move the repo to a path without spaces.",
  );
}

const [command, ...args] = commandArgs;
const child = spawn(command, args, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    TEMP: localTempDir,
    TMP: localTempDir,
    TMPDIR: localTempDir,
    CARGO_TARGET_DIR: cargoTargetDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(
    `[with-stable-build-env] failed to start command: ${error.message}`,
  );
  process.exit(1);
});
