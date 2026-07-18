import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  CodexIntegrationSnapshotSchema,
  CodexIntegrationUnavailableError,
} from "../codex/codex-integration";
import { isWorkgroveCommandName } from "../controller/command-contract";
import {
  MissingWorktreeConfigError,
  WorkspaceController,
} from "../controller/workspace-controller";
import {
  LogsQuerySchema,
  LogsResponseSchema,
  WorkspaceQuerySchema,
  WorkspaceSnapshotSchema,
} from "./schemas";

const APP_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOST = "127.0.0.1";
const PORT = Number(process.env.WORKGROVE_PORT ?? 3999);
const MAX_BODY = 64 * 1024;
const COMMAND_PATH = /^\/api\/commands\/([a-z-]+)$/;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};
const token = randomBytes(32).toString("base64url");
const controller = new WorkspaceController();

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function errorBody(error: unknown) {
  if (error instanceof CodexIntegrationUnavailableError) {
    return { code: error.code, error: error.message };
  }
  if (error instanceof MissingWorktreeConfigError) {
    return {
      code: error.code,
      configPath: error.configPath,
      error: error.message,
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY) {
      throw new Error("Request body is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function authorized(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const expectedOrigin = `http://${request.headers.host}`;
  return (
    request.headers["x-workgrove-token"] === token &&
    (!origin || origin === expectedOrigin)
  );
}

const vite =
  process.env.NODE_ENV === "production"
    ? null
    : await createViteServer({
        appType: "spa",
        root: APP_ROOT,
        server: { middlewareMode: true },
      });

async function handleGetApi(
  url: URL,
  response: ServerResponse
): Promise<boolean> {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      pid: process.pid,
      service: "workgrove",
    });
    return true;
  }
  if (url.pathname === "/api/session") {
    sendJson(response, 200, { token });
    return true;
  }
  if (url.pathname === "/api/workspace") {
    const { repoPath } = WorkspaceQuerySchema.parse(
      Object.fromEntries(url.searchParams)
    );
    sendJson(
      response,
      200,
      WorkspaceSnapshotSchema.parse(controller.inspect(repoPath))
    );
    return true;
  }
  if (url.pathname === "/api/codex") {
    const { repoPath } = WorkspaceQuerySchema.parse(
      Object.fromEntries(url.searchParams)
    );
    sendJson(
      response,
      200,
      CodexIntegrationSnapshotSchema.parse(
        await controller.inspectCodex(repoPath)
      )
    );
    return true;
  }
  if (url.pathname !== "/api/logs") {
    return false;
  }
  const { appGroupName, repoPath, worktreeId } = LogsQuerySchema.parse(
    Object.fromEntries(url.searchParams)
  );
  sendJson(
    response,
    200,
    LogsResponseSchema.parse({
      lines: controller.logs(repoPath, worktreeId, appGroupName),
    })
  );
  return true;
}

async function handleCommand(
  request: IncomingMessage,
  response: ServerResponse,
  command: string
): Promise<void> {
  if (!authorized(request)) {
    sendJson(response, 403, { error: "Invalid mutation session" });
    return;
  }
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    sendJson(response, 415, { error: "Commands require application/json" });
    return;
  }
  if (!isWorkgroveCommandName(command)) {
    sendJson(response, 404, { error: "Unknown command" });
    return;
  }
  const result = await controller.execute(command, await readJson(request));
  sendJson(response, 200, result);
}

function serveUi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): void {
  if (vite) {
    vite.middlewares(request, response, (error: unknown) => {
      if (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.writeHead(404).end("Not found");
      }
    });
    return;
  }
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = join(APP_ROOT, "dist", requested);
  if (!(existsSync(file) && statSync(file).isFile())) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? `${HOST}:${PORT}`}`
  );
  try {
    if (request.method === "GET" && (await handleGetApi(url, response))) {
      return;
    }
    const commandMatch =
      request.method === "POST" ? COMMAND_PATH.exec(url.pathname) : null;
    if (commandMatch) {
      await handleCommand(request, response, commandMatch[1]);
      return;
    }
    serveUi(request, response, url);
  } catch (error) {
    sendJson(
      response,
      error instanceof CodexIntegrationUnavailableError ? 503 : 400,
      errorBody(error)
    );
  }
});

function closeHttpServer(): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= Promise.all([
    closeHttpServer(),
    controller.close(),
    vite?.close() ?? Promise.resolve(),
  ]).then(() => undefined);
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown().catch(() => {
      process.exitCode = 1;
    });
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Workgrove: http://${HOST}:${PORT}/`);
});
