import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
function fallbackDownloadDir() {
  if (process.platform === "darwin") {
    return "/Users/runner/Downloads";
  }
  if (process.platform === "linux") {
    return "/home/runner/Downloads";
  }
  return "C:/Users/runner/Downloads";
}

const DOWNLOAD_DIR =
  process.env.KIYA_DOWNLOAD_DIR?.trim() || fallbackDownloadDir();
const ARIA2_RPC_URL = "http://127.0.0.1:16800/jsonrpc";

const tools = [
  {
    name: "download_file",
    description:
      "Download a remote file through aria2. Always provide both the direct URL and a final filename in `output`. `output` must be a filename only with extension, never a directory path.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Direct http/https file URL to download",
        },
        output: {
          type: "string",
          description:
            "Required target filename only, including extension. Do not include any directory path.",
        },
      },
      required: ["url", "output"],
    },
  },
  {
    name: "play_video",
    description:
      "Queue a video for the Kiya in-app player. Always provide a human-readable `title` when playing a file or media URL so the player and playlist do not fall back to generic names like `play`.",
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
          description: "Required display title shown in the in-app player and playlist",
        },
      },
      required: ["title"],
      anyOf: [{ required: ["filePath"] }, { required: ["url"] }],
    },
  },
  {
    name: "show_images",
    description:
      "Open one or more local or remote images in the Kiya in-app image viewer. Provide a non-empty `images` array of http/https URLs or absolute local file paths. Use `title` to describe the image set when helpful.",
    inputSchema: {
      type: "object",
      properties: {
        images: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Ordered list of image URLs or absolute local image file paths to show",
        },
        title: {
          type: "string",
          description: "Optional gallery title shown in the image viewer",
        },
        startIndex: {
          type: "number",
          description: "Optional zero-based image index to open initially",
        },
      },
      required: ["images"],
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

function resolveUniqueOutputName(downloadDir, output) {
  const requestedPath = path.join(downloadDir, output);
  if (!fs.existsSync(requestedPath)) {
    return output;
  }

  const parsed = path.parse(output);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${parsed.name}(${index})${parsed.ext}`;
    const candidatePath = path.join(downloadDir, candidate);
    if (!fs.existsSync(candidatePath)) {
      return candidate;
    }
  }

  return output;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "download_file":
      return downloadFile(args);
    case "play_video":
      return playVideo(args);
    case "show_images":
      return showImages(args);
    case "open_folder":
      return openFolder(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function downloadFile(args) {
  if (typeof args.url !== "string" || !args.url.trim()) {
    throw new Error("download_file requires a valid url");
  }

  if (typeof args.output !== "string" || !args.output.trim()) {
    throw new Error("download_file requires a valid output filename");
  }

  const requestedOutput = path.basename(args.output.trim());
  if (!requestedOutput || requestedOutput === "." || requestedOutput === "..") {
    throw new Error("download_file requires a valid output filename");
  }
  const output = resolveUniqueOutputName(DOWNLOAD_DIR, requestedOutput);

  const response = await fetch(ARIA2_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kiya-local-mcp",
      method: "aria2.addUri",
      params: [[args.url], {
        dir: DOWNLOAD_DIR,
        out: output,
        "allow-overwrite": "false",
        "auto-file-renaming": "true",
      }],
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
    `Download started via aria2. gid=${gid}, dir=${DOWNLOAD_DIR}, out=${output}`,
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
  if (typeof args.title !== "string" || !args.title.trim()) {
    throw new Error("play_video requires a non-empty title");
  }

  const title = args.title.trim();
  return toolResult(
    `Queued ${mediaSource.kind} ${mediaSource.value} with title ${title}`,
  );
}

async function showImages(args) {
  if (!Array.isArray(args.images)) {
    throw new Error("show_images requires a non-empty images array");
  }

  const images = args.images
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (images.length === 0) {
    throw new Error("show_images requires a non-empty images array");
  }

  const title =
    typeof args.title === "string" && args.title.trim()
      ? args.title.trim()
      : images.length === 1
        ? path.basename(images[0])
        : "图片预览";

  return toolResult(
    `Queued ${images.length} image(s) with title ${title}`,
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
