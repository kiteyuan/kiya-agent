import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const inTreeTarget = path.join(projectRoot, "src-tauri", "target");

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

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "lpt1",
  "lpt2",
  "lpt3",
]);

function isWindowsReservedName(name) {
  const base = name.split(".")[0]?.toLowerCase() ?? "";
  return WINDOWS_RESERVED.has(base);
}

function deleteWindowsReservedFile(filePath) {
  // Extended-length path is required for reserved device names like "nul".
  const extended = filePath.startsWith("\\\\?\\")
    ? filePath
    : `\\\\?\\${filePath}`;
  try {
    fs.unlinkSync(extended);
    return true;
  } catch {
    const result = spawnSync(
      "cmd.exe",
      ["/c", "del", "/f", "/q", extended],
      { stdio: "ignore" },
    );
    return result.status === 0;
  }
}

function removeTree(root) {
  if (!fs.existsSync(root)) {
    console.log(`[clean-tauri-target] skip missing: ${root}`);
    return;
  }

  if (process.platform === "win32") {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (isWindowsReservedName(entry.name)) {
          const deleted = deleteWindowsReservedFile(fullPath);
          console.log(
            `[clean-tauri-target] ${deleted ? "removed" : "failed"} reserved file: ${fullPath}`,
          );
        }
      }
    }
  }

  try {
    fs.rmSync(root, { recursive: true, force: true });
    console.log(`[clean-tauri-target] removed: ${root}`);
  } catch (error) {
    if (process.platform === "win32") {
      const extended = `\\\\?\\${root}`;
      const result = spawnSync("cmd.exe", ["/c", "rd", "/s", "/q", extended], {
        stdio: "inherit",
      });
      if (result.status === 0) {
        console.log(`[clean-tauri-target] removed via rd: ${root}`);
        return;
      }
    }
    console.error(
      `[clean-tauri-target] failed to remove ${root}: ${error.message}`,
    );
    process.exitCode = 1;
  }
}

const stableTarget = resolveStableCargoTargetDir();
console.log("[clean-tauri-target] cleaning Tauri/cargo target directories...");
removeTree(inTreeTarget);
removeTree(stableTarget);

const cargoCheck = path.join(projectRoot, ".cargo-check-tauri");
if (fs.existsSync(cargoCheck)) {
  removeTree(cargoCheck);
}

console.log("[clean-tauri-target] done");
