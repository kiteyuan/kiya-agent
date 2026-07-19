import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const resourcesDir = path.join(projectRoot, "src-tauri", "resources");
const vendorRuntimeDir = path.join(projectRoot, "vendor", "runtime");

function detectRuntimeTarget() {
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

const runtimeTarget = process.env.KIYA_RUNTIME_TARGET || detectRuntimeTarget();
const targetVendorDir = path.join(vendorRuntimeDir, runtimeTarget);

const copies = [];
const manifest = {
  generatedAt: new Date().toISOString(),
  resourcesDir,
  runtimeTarget,
  vendorSourceDir: targetVendorDir,
  copied: [],
  optional: [],
  warnings: [],
};

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait is acceptable here because this is a short-lived build script.
  }
}

function normalizeForWindowsPathMatch(target) {
  return target.replaceAll("/", "\\").toLowerCase();
}

function terminateProjectRuntimeProcesses() {
  if (process.platform !== "win32") {
    return;
  }

  const pathPrefix = normalizeForWindowsPathMatch(projectRoot);
  const probe = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `
$ErrorActionPreference = 'SilentlyContinue'
$targets = @('kiya-agent', 'aria2', 'aria2c', 'node')
$processes = Get-Process | Where-Object { $targets -contains $_.ProcessName.ToLowerInvariant() } | ForEach-Object {
  try {
    [PSCustomObject]@{
      Id = $_.Id
      Name = $_.ProcessName
      Path = $_.Path
    }
  } catch {
    $null
  }
} | Where-Object { $_ -and $_.Path }
$processes | ConvertTo-Json -Compress
      `,
    ],
    {
      encoding: "utf8",
    },
  );

  if (probe.status !== 0 || !probe.stdout.trim()) {
    return;
  }

  const processes = JSON.parse(probe.stdout.trim());
  const list = Array.isArray(processes) ? processes : [processes];
  for (const processInfo of list) {
    if (!processInfo?.Path) {
      continue;
    }

    const executablePath = normalizeForWindowsPathMatch(processInfo.Path);
    if (!executablePath.startsWith(pathPrefix)) {
      continue;
    }

    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(processInfo.Id), "/T", "/F"],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      copies.push(
        `[runtime] stopped ${processInfo.Name} (${processInfo.Id}) at ${processInfo.Path}`,
      );
    }
  }
}

function resetDir(target) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      ensureDir(target);
      return;
    } catch (error) {
      const retryable =
        error?.code === "EPERM" ||
        error?.code === "EBUSY" ||
        error?.code === "ENOTEMPTY";
      if (!retryable || attempt === 8) {
        throw error;
      }
      terminateProjectRuntimeProcesses();
      copies.push(
        `[runtime] retrying resource cleanup after ${error?.code ?? "unknown"} on ${error?.path ?? target} (attempt ${attempt})`,
      );
      sleepSync(300 * attempt);
    }
  }
}

function copyFileIfExists(source, destination, options = {}) {
  const exists = fs.existsSync(source);
  const entry = {
    source,
    destination,
    required: Boolean(options.required),
    exists,
  };

  if (!exists) {
    if (options.required) {
      manifest.warnings.push(`missing required file: ${source}`);
    } else {
      manifest.optional.push(entry);
    }
    return false;
  }

  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  manifest.copied.push(entry);
  copies.push(`${source} -> ${destination}`);
  return true;
}

function copyDirectory(source, destination, options = {}) {
  if (!fs.existsSync(source)) {
    if (options.required) {
      manifest.warnings.push(`missing required directory: ${source}`);
    } else {
      manifest.optional.push({
        source,
        destination,
        required: Boolean(options.required),
        exists: false,
      });
    }
    return false;
  }

  ensureDir(path.dirname(destination));
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
  });
  manifest.copied.push({
    source,
    destination,
    required: Boolean(options.required),
    exists: true,
  });
  copies.push(`${source} -> ${destination}`);
  return true;
}

function copyFirstAvailable(sources, destination, options = {}) {
  const source = sources.find((candidate) => fs.existsSync(candidate));
  if (source) {
    return copyFileIfExists(source, destination, options);
  }

  if (options.required) {
    manifest.warnings.push(`missing required file: ${sources[0]}`);
  } else {
    manifest.optional.push({
      source: sources,
      destination,
      required: Boolean(options.required),
      exists: false,
    });
  }
  return false;
}

function copyFirstDirectory(sources, destination, options = {}) {
  const source = sources.find((candidate) => fs.existsSync(candidate));
  if (source) {
    return copyDirectory(source, destination, options);
  }

  if (options.required) {
    manifest.warnings.push(`missing required directory: ${sources[0]}`);
  } else {
    manifest.optional.push({
      source: sources,
      destination,
      required: Boolean(options.required),
      exists: false,
    });
  }
  return false;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function installRuntimeDependencies(runtimeDir) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["install", "--omit=dev", "--no-audit", "--no-fund"],
    {
      cwd: runtimeDir,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    },
  );

  if (result.status === 0) {
    copies.push(`[runtime] installed production dependencies in ${runtimeDir}`);
    return;
  }

  const details = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  throw new Error(
    `failed to install runtime dependencies in ${runtimeDir}${details ? `: ${details}` : ""}`,
  );
}

function stripRuntimeArtifacts(targetDir) {
  const removableDirectories = new Set([
    ".github",
    ".vscode",
    "test",
    "tests",
    "__tests__",
    "__mocks__",
    "example",
    "examples",
  ]);
  const removableSuffixes = [
    ".d.ts",
    ".d.cts",
    ".d.mts",
    ".d.ts.map",
    ".d.cts.map",
    ".d.mts.map",
    ".map",
    ".md",
    ".markdown",
    ".tsbuildinfo",
  ];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (removableDirectories.has(entry.name.toLowerCase())) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          continue;
        }

        walk(fullPath);
        continue;
      }

      const lowerName = entry.name.toLowerCase();
      if (removableSuffixes.some((suffix) => lowerName.endsWith(suffix))) {
        fs.rmSync(fullPath, { force: true });
        continue;
      }

      // Windows reserved device names (e.g. "nul") break later target cleanup.
      const reservedBase = lowerName.split(".")[0];
      if (
        ["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3"].includes(
          reservedBase,
        )
      ) {
        try {
          fs.rmSync(fullPath, { force: true });
        } catch {
          if (process.platform === "win32") {
            try {
              fs.unlinkSync(`\\\\?\\${fullPath}`);
            } catch {
              // Best-effort cleanup; packaging can continue.
            }
          }
        }
      }
    }
  }

  walk(targetDir);
  copies.push(`[runtime] stripped non-runtime artifacts in ${targetDir}`);
}

terminateProjectRuntimeProcesses();
resetDir(resourcesDir);

copyFileIfExists(
  path.join(projectRoot, "local-mcp", "src", "index.js"),
  path.join(resourcesDir, "local-mcp.js"),
  { required: true },
);

copyFileIfExists(
  path.join(projectRoot, "src-tauri", "dev-bin", "mock-aria2-rpc.mjs"),
  path.join(resourcesDir, "mock-aria2-rpc.mjs"),
  { required: true },
);

copyFirstAvailable(
  [
    path.join(targetVendorDir, "aria2c.exe"),
    path.join(targetVendorDir, "aria2.exe"),
  ],
  path.join(resourcesDir, "aria2c.exe"),
);
copyFirstAvailable(
  [
    path.join(targetVendorDir, "aria2.exe"),
    path.join(targetVendorDir, "aria2c.exe"),
  ],
  path.join(resourcesDir, "aria2.exe"),
);
copyFirstAvailable(
  [path.join(targetVendorDir, "aria2c"), path.join(targetVendorDir, "aria2")],
  path.join(resourcesDir, "aria2c"),
);
copyFirstAvailable(
  [path.join(targetVendorDir, "aria2"), path.join(targetVendorDir, "aria2c")],
  path.join(resourcesDir, "aria2"),
);

copyFirstAvailable(
  [
    path.join(targetVendorDir, "node.exe"),
    path.join(targetVendorDir, "node"),
  ],
  path.join(resourcesDir, "node.exe"),
);
copyFirstAvailable(
  [path.join(targetVendorDir, "node"), path.join(targetVendorDir, "node.exe")],
  path.join(resourcesDir, "node"),
);
copyFirstAvailable(
  [path.join(targetVendorDir, "npm.cmd"), path.join(targetVendorDir, "npm")],
  path.join(resourcesDir, "npm.cmd"),
);
copyFirstAvailable(
  [path.join(targetVendorDir, "npx.cmd"), path.join(targetVendorDir, "npx")],
  path.join(resourcesDir, "npx.cmd"),
);
copyFirstAvailable([path.join(targetVendorDir, "npm")], path.join(resourcesDir, "npm"));
copyFirstAvailable([path.join(targetVendorDir, "npx")], path.join(resourcesDir, "npx"));
copyFirstDirectory(
  [path.join(targetVendorDir, "node_modules")],
  path.join(resourcesDir, "node_modules"),
);

const rootPackageJson = readJson(path.join(projectRoot, "package.json"));
const piVersion =
  rootPackageJson.dependencies?.["@earendil-works/pi-coding-agent"] ?? null;
if (!piVersion) {
  throw new Error("missing @earendil-works/pi-coding-agent dependency in package.json");
}

const piRuntimeDir = path.join(resourcesDir, "pi-runtime");
ensureDir(piRuntimeDir);

writeJson(path.join(piRuntimeDir, "package.json"), {
  name: "kiya-agent-pi-runtime",
  private: true,
  version: "0.0.0",
  dependencies: {
    "@earendil-works/pi-coding-agent": piVersion,
    "pi-mcp-adapter": "^2.11.0",
  },
});
installRuntimeDependencies(piRuntimeDir);
stripRuntimeArtifacts(path.join(piRuntimeDir, "node_modules"));

writeJson(path.join(resourcesDir, "runtime-manifest.json"), {
  ...manifest,
  piRuntimeVersion: piVersion,
});

fs.writeFileSync(
  path.join(resourcesDir, "README.txt"),
  [
    "Kiya Agent runtime resources",
    "",
    `Runtime target: ${runtimeTarget}`,
    "",
    "Optional vendor inputs:",
    "  vendor/runtime/windows-x64/*",
    "  vendor/runtime/darwin-arm64/*",
    "  vendor/runtime/darwin-x64/*",
    "  vendor/runtime/linux-x64/*",
    "",
    "Recommended per-target layout:",
    "  <target>/aria2c(.exe)",
    "  <target>/node(.exe)",
    "  <target>/npm(.cmd)",
    "  <target>/npx(.cmd)",
    "  <target>/node_modules/*",
    "",
    "Generated files:",
    "  local-mcp.js",
    "  mock-aria2-rpc.mjs",
    "  runtime-manifest.json",
    "  pi-runtime/node_modules/*",
  ].join("\n"),
);

console.log("[prepare-tauri-resources] done");
for (const line of copies) {
  console.log(`[prepare-tauri-resources] ${line}`);
}

if (manifest.warnings.length > 0) {
  for (const warning of manifest.warnings) {
    console.warn(`[prepare-tauri-resources] warning: ${warning}`);
  }
}
