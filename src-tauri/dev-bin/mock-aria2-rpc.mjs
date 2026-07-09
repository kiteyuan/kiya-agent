import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = 16800;
const DEFAULT_DOWNLOAD_DIR =
  process.env.KIYA_DOWNLOAD_DIR?.trim() ||
  (process.platform === "darwin"
    ? "/Users/runner/Downloads/KiyaAgent"
    : process.platform === "linux"
      ? "/home/runner/Downloads/KiyaAgent"
      : "C:/Users/runner/Downloads/KiyaAgent");

const tasks = new Map();
const stoppedOrder = [];

function createGid() {
  return Math.random().toString(16).slice(2, 18);
}

function makeTask(url, options = {}) {
  const gid = createGid();
  const out = options.out || "download.mp4";
  const dir = options.dir || DEFAULT_DOWNLOAD_DIR;
  const filePath = path.join(dir, out);

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
  const { id, method, params = [] } = payload;

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
      Array.from(tasks.values()).filter((task) => task.status === "waiting"),
    );
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
