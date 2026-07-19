import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = 16800;
const DEFAULT_DOWNLOAD_DIR =
  process.env.KIYA_DOWNLOAD_DIR?.trim() ||
  (process.platform === "darwin"
    ? "/Users/runner/Downloads"
    : process.platform === "linux"
      ? "/home/runner/Downloads"
      : "C:/Users/runner/Downloads");
const ARIA2_RPC_SECRET = process.env.KIYA_ARIA2_RPC_SECRET?.trim() || "";

function normalizeParams(params = []) {
  if (typeof params[0] === "string" && params[0].startsWith("token:")) {
    const provided = params[0].slice("token:".length);
    if (ARIA2_RPC_SECRET && provided !== ARIA2_RPC_SECRET) {
      throw new Error("Unauthorized aria2 RPC token");
    }
    return params.slice(1);
  }

  if (ARIA2_RPC_SECRET) {
    throw new Error("Missing aria2 RPC token");
  }

  return params;
}

const tasks = new Map();
const stoppedOrder = [];

function createGid() {
  return Math.random().toString(16).slice(2, 18);
}

function resolveDownloadPath(dir, out, options = {}) {
  const requestedPath = path.join(dir, out);
  const allowOverwrite = String(options["allow-overwrite"] ?? "false") === "true";
  const autoFileRenaming = String(options["auto-file-renaming"] ?? "true") !== "false";

  if (allowOverwrite) {
    return requestedPath;
  }

  const occupiedPaths = new Set(
    Array.from(tasks.values())
      .map((task) => task.files[0]?.path)
      .filter(Boolean),
  );

  if (!fs.existsSync(requestedPath) && !occupiedPaths.has(requestedPath)) {
    return requestedPath;
  }

  if (!autoFileRenaming) {
    return requestedPath;
  }

  const parsed = path.parse(out);
  for (let index = 1; index < 10_000; index += 1) {
    const candidateName = `${parsed.name}(${index})${parsed.ext}`;
    const candidatePath = path.join(dir, candidateName);
    if (!fs.existsSync(candidatePath) && !occupiedPaths.has(candidatePath)) {
      return candidatePath;
    }
  }

  return requestedPath;
}

function makeTask(url, options = {}) {
  const gid = createGid();
  const out = options.out || "download.mp4";
  const dir = options.dir || DEFAULT_DOWNLOAD_DIR;
  const filePath = resolveDownloadPath(dir, out, options);

  return {
    gid,
    status: "active",
    totalLength: String(80 * 1024 * 1024),
    completedLength: "0",
    downloadSpeed: String(3 * 1024 * 1024),
    files: [
      {
        path: filePath,
        uris: [{ uri: url }],
      },
    ],
  };
}

function markStopped(gid) {
  stoppedOrder.unshift(gid);
  while (stoppedOrder.length > 20) {
    stoppedOrder.pop();
  }
}

function updateTasks() {
  for (const task of tasks.values()) {
    if (task.status !== "active") {
      continue;
    }

    const completed = Number(task.completedLength);
    const total = Number(task.totalLength);
    const next = Math.min(total, completed + 6 * 1024 * 1024);
    task.completedLength = String(next);

    if (next >= total) {
      task.status = "complete";
      task.downloadSpeed = "0";
      markStopped(task.gid);

      const filePath = task.files[0]?.path;
      if (filePath) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "");
        }
      }
    }
  }
}

function jsonRpc(id, result) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function jsonRpcError(id, message) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
    },
  });
}

function handleRpc(payload) {
  const { id, method } = payload;
  let params;
  try {
    params = normalizeParams(payload.params || []);
  } catch (error) {
    return jsonRpcError(id, error.message || "Unauthorized");
  }

  if (method === "aria2.addUri") {
    const uris = params[0] || [];
    const options = params[1] || {};
    const task = makeTask(uris[0], options);
    tasks.set(task.gid, task);
    return jsonRpc(id, task.gid);
  }

  if (method === "aria2.tellActive") {
    return jsonRpc(
      id,
      Array.from(tasks.values()).filter((task) => task.status === "active"),
    );
  }

  if (method === "aria2.tellWaiting") {
    return jsonRpc(
      id,
      Array.from(tasks.values()).filter(
        (task) => task.status === "waiting" || task.status === "paused",
      ),
    );
  }

  if (method === "aria2.pause") {
    const gid = params[0];
    const task = tasks.get(gid);
    if (!task) {
      return jsonRpcError(id, `Task not found: ${gid}`);
    }

    task.status = "paused";
    task.downloadSpeed = "0";
    return jsonRpc(id, gid);
  }

  if (method === "aria2.unpause") {
    const gid = params[0];
    const task = tasks.get(gid);
    if (!task) {
      return jsonRpcError(id, `Task not found: ${gid}`);
    }

    task.status = "active";
    task.downloadSpeed = String(3 * 1024 * 1024);
    return jsonRpc(id, gid);
  }

  if (method === "aria2.forceRemove") {
    const gid = params[0];
    if (!tasks.has(gid)) {
      return jsonRpcError(id, `Task not found: ${gid}`);
    }

    tasks.delete(gid);
    const nextStoppedOrder = stoppedOrder.filter((value) => value !== gid);
    stoppedOrder.length = 0;
    stoppedOrder.push(...nextStoppedOrder);
    return jsonRpc(id, gid);
  }

  if (method === "aria2.removeDownloadResult") {
    const gid = params[0];
    if (!tasks.has(gid)) {
      return jsonRpcError(id, `Task not found: ${gid}`);
    }

    tasks.delete(gid);
    const nextStoppedOrder = stoppedOrder.filter((value) => value !== gid);
    stoppedOrder.length = 0;
    stoppedOrder.push(...nextStoppedOrder);
    return jsonRpc(id, gid);
  }

  if (method === "aria2.tellStopped") {
    return jsonRpc(
      id,
      stoppedOrder
        .map((gid) => tasks.get(gid))
        .filter(Boolean),
    );
  }

  return jsonRpcError(id, `Unsupported method: ${method}`);
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/jsonrpc") {
    response.statusCode = 404;
    response.end("not found");
    return;
  }

  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    try {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      response.end(handleRpc(payload));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        jsonRpcError(
          null,
          error instanceof Error ? error.message : "Invalid JSON",
        ),
      );
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-aria2] listening on http://${HOST}:${PORT}/jsonrpc`);
});

setInterval(updateTasks, 1000);
