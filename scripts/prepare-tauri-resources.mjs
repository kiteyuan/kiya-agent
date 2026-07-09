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

function resetDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(target);
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

const piRuntimeDir = path.join(resourcesDir, "pi-runtime");
ensureDir(piRuntimeDir);

copyDirectory(path.join(projectRoot, "node_modules"), path.join(piRuntimeDir, "node_modules"));
copyFileIfExists(
  path.join(projectRoot, "package.json"),
  path.join(piRuntimeDir, "package.json"),
  { required: true },
);
copyFileIfExists(
  path.join(projectRoot, "package-lock.json"),
  path.join(piRuntimeDir, "package-lock.json"),
  { required: true },
);

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
