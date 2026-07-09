import readline from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";

function fallbackDownloadDir() {
  if (process.platform === "darwin") {
    return "/Users/runner/Downloads/KiyaAgent";
  }
  if (process.platform === "linux") {
    return "/home/runner/Downloads/KiyaAgent";
  }
  return "C:/Users/runner/Downloads/KiyaAgent";
}

const DOWNLOAD_DIR =
  process.env.KIYA_DOWNLOAD_DIR?.trim() || fallbackDownloadDir();
const ARIA2_RPC_URL = "http://127.0.0.1:16800/jsonrpc";

const tools = [
  {
    name: "download_file",
    description:
      "Download a remote file through aria2. Use this immediately when the user asks to download, save, cache, or fetch a direct file URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Direct http/https file URL to download",
        },
        output: {
          type: "string",
          description: "Optional output filename or absolute path",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "play_video",
    description:
      "Queue a video for the Kiya in-app player. Use this immediately when the user asks to play a video, open a media link, or play an mp4/http/https video URL.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute local video file path to play in the in-app player",
        },
        url: {
          type: "string",
          description: "Remote http/https video URL to play in the in-app player",
        },
        title: {
          type: "string",
          description: "Optional display title shown in the in-app player and playlist",
        },
      },
      anyOf: [{ required: ["filePath"] }, { required: ["url"] }],
    },
  },
  {
    name: "open_folder",
    description:
      "Open the download directory or a target folder in the system file manager.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute folder path" },
      },
      required: ["path"],
    },
  },
];

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(id, result) {
  output({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function fail(id, message) {
  output({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
    },
  });
}

function toolResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: false,
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "download_file":
      return downloadFile(args);
    case "play_video":
      return playVideo(args);
    case "open_folder":
      return openFolder(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function deriveFilename(url) {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").pop();
    return filename && filename.trim()
      ? decodeURIComponent(filename)
      : "download.mp4";
  } catch {
    return "download.mp4";
  }
}

async function downloadFile(args) {
  if (typeof args.url !== "string" || !args.url.trim()) {
    throw new Error("download_file requires a valid url");
  }

  const filename =
    typeof args.output === "string" && args.output.trim()
      ? path.basename(args.output)
      : deriveFilename(args.url);

  const response = await fetch(ARIA2_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kiya-local-mcp",
      method: "aria2.addUri",
      params: [[args.url], { dir: DOWNLOAD_DIR, out: filename }],
    }),
  }).catch((error) => {
    throw new Error(`aria2 RPC unavailable: ${error.message}`);
  });

  if (!response.ok) {
    throw new Error(`aria2 RPC failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "aria2 RPC returned an error");
  }

  const gid = payload.result || "unknown";
  return toolResult(
    `Download started via aria2. gid=${gid}, output=${path.join(DOWNLOAD_DIR, filename)}`,
  );
}

function spawnDetached(command, commandArgs) {
  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
}

function resolveMediaSource(args) {
  if (typeof args.url === "string" && args.url.trim()) {
    return {
      kind: "remote-url",
      value: args.url.trim(),
    };
  }

  if (typeof args.filePath === "string" && args.filePath.trim()) {
    return {
      kind: "local-file",
      value: args.filePath.trim(),
    };
  }

  throw new Error("play_video requires url or filePath");
}

async function playVideo(args) {
  const mediaSource = resolveMediaSource(args);
  const title =
    typeof args.title === "string" && args.title.trim() ? args.title.trim() : null;
  return toolResult(
    `Queued ${mediaSource.kind} ${mediaSource.value}${title ? ` with title ${title}` : ""}`,
  );
}

async function openFolder(args) {
  const targetPath =
    typeof args.path === "string" && args.path.trim() ? args.path : DOWNLOAD_DIR;

  if (process.platform === "win32") {
    spawnDetached("explorer", [targetPath]);
  } else if (process.platform === "darwin") {
    spawnDetached("open", [targetPath]);
  } else {
    spawnDetached("xdg-open", [targetPath]);
  }

  return toolResult(`Opened folder ${targetPath}`);
}

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(line);
  } catch (error) {
    output({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: `Invalid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    });
    return;
  }

  if (payload.method === "initialize") {
    respond(payload.id, {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "kiya-local-mcp",
        version: "0.1.0",
      },
    });
    return;
  }

  if (payload.method === "notifications/initialized") {
    return;
  }

  if (payload.method === "tools/list") {
    respond(payload.id, { tools });
    return;
  }

  if (payload.method === "tools/call") {
    Promise.resolve()
      .then(() => callTool(payload.params?.name, payload.params?.arguments))
      .then((result) => {
        respond(payload.id, result);
      })
      .catch((error) => {
        fail(
          payload.id,
          error instanceof Error ? error.message : "Tool call failed",
        );
      });
    return;
  }

  if (payload.id) {
    fail(payload.id, `Method not found: ${payload.method}`);
  }
});
