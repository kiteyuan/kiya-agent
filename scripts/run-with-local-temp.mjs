import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const tempDir = path.join(projectRoot, ".tmp", "tauri-build");

const separatorIndex = process.argv.indexOf("--");
const commandArgs = separatorIndex >= 0
  ? process.argv.slice(separatorIndex + 1)
  : process.argv.slice(2);

if (commandArgs.length === 0) {
  console.error("[run-with-local-temp] missing command");
  process.exit(1);
}

fs.mkdirSync(tempDir, { recursive: true });

const [command, ...args] = commandArgs;
const child = spawn(command, args, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
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
  console.error(`[run-with-local-temp] failed to start command: ${error.message}`);
  process.exit(1);
});
