import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppGroupLifecycleError } from "../controller/app-group-lifecycle-error";
import {
  createWorkgroveServer,
  type WorkgroveServerController,
} from "./workgrove-server";

describe("Workgrove HTTP server", () => {
  it("preserves stable App-group lifecycle error codes", async () => {
    const appRoot = mkdtempSync(join(tmpdir(), "workgrove-server-error-"));
    const controller = {
      close: () => Promise.resolve(),
      execute: () =>
        Promise.reject(
          new AppGroupLifecycleError(
            "route-conflict",
            "web.main.repo.localhost is already routed elsewhere"
          )
        ),
      handleCodexHook: () => ({ accepted: false }),
      inspect: () => {
        throw new Error("not used");
      },
      inspectCodex: () => Promise.reject(new Error("not used")),
      logs: () => [],
    } as unknown as WorkgroveServerController;
    const server = await createWorkgroveServer({
      appRoot,
      controller,
      development: false,
      enableCodexHooks: false,
      port: 0,
    });

    try {
      const url = await server.listen();
      const session = (await (
        await fetch(new URL("/api/session", url))
      ).json()) as { token: string };
      const response = await fetch(new URL("/api/commands/start-apps", url), {
        body: JSON.stringify({
          appGroupName: "development",
          repoPath: "/code/repo",
          worktreeId: "main",
        }),
        headers: {
          "content-type": "application/json",
          "x-workgrove-token": session.token,
        },
        method: "POST",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: "route-conflict",
        error: "web.main.repo.localhost is already routed elsewhere",
      });
    } finally {
      await server.close();
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it("starts, authorizes commands, and closes through one interface", async () => {
    const appRoot = mkdtempSync(join(tmpdir(), "workgrove-server-test-"));
    let closeCalls = 0;
    let commandCalls = 0;
    const controller = {
      close: () => {
        closeCalls += 1;
        return Promise.resolve();
      },
      execute: () => {
        commandCalls += 1;
        return Promise.resolve({
          command: "clear-logs",
          message: "cleared",
          ok: true,
        });
      },
      handleCodexHook: () => ({ accepted: false }),
      inspect: () => {
        throw new Error("not used");
      },
      inspectCodex: () => {
        throw new Error("not used");
      },
      logs: () => [],
    } as unknown as WorkgroveServerController;
    const server = await createWorkgroveServer({
      appRoot,
      controller,
      development: false,
      enableCodexHooks: false,
      port: 0,
    });

    try {
      const url = await server.listen();
      const health = await fetch(new URL("/api/health", url));
      expect(await health.json()).toMatchObject({
        ok: true,
        service: "workgrove",
      });

      const session = (await (
        await fetch(new URL("/api/session", url))
      ).json()) as { token: string };
      const unauthorized = await fetch(
        new URL("/api/commands/clear-logs", url),
        {
          body: "{}",
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      expect(unauthorized.status).toBe(403);
      const authorized = await fetch(new URL("/api/commands/clear-logs", url), {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "x-workgrove-token": session.token,
        },
        method: "POST",
      });
      expect(authorized.status).toBe(200);
      expect(commandCalls).toBe(1);
    } finally {
      await server.close();
      await server.close();
      rmSync(appRoot, { force: true, recursive: true });
    }
    expect(closeCalls).toBe(1);
  });

  it("formats IPv6 hosts as valid origins", async () => {
    const appRoot = mkdtempSync(join(tmpdir(), "workgrove-server-ipv6-"));
    const controller = {
      close: () => Promise.resolve(),
      execute: () => Promise.reject(new Error("not used")),
      handleCodexHook: () => ({ accepted: false }),
      inspect: () => {
        throw new Error("not used");
      },
      inspectCodex: () => Promise.reject(new Error("not used")),
      logs: () => [],
    } as unknown as WorkgroveServerController;
    const server = await createWorkgroveServer({
      appRoot,
      controller,
      development: false,
      enableCodexHooks: false,
      host: "::1",
      port: 0,
    });

    try {
      const url = await server.listen();
      expect(url).toStartWith("http://[::1]:");
      expect((await fetch(new URL("/api/health", url))).status).toBe(200);
    } finally {
      await server.close();
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it("cleans up the Codex hook capability on process exit", async () => {
    const appRoot = mkdtempSync(join(tmpdir(), "workgrove-server-exit-"));
    const codexDirectory = join(appRoot, "codex");
    const capabilityFile = join(codexDirectory, "capability.json");
    const controller = {
      close: () => Promise.resolve(),
      execute: () => Promise.reject(new Error("not used")),
      handleCodexHook: () => ({ accepted: false }),
      inspect: () => {
        throw new Error("not used");
      },
      inspectCodex: () => Promise.reject(new Error("not used")),
      logs: () => [],
    } as unknown as WorkgroveServerController;
    const previousExitListeners = new Set(process.listeners("exit"));
    const server = await createWorkgroveServer({
      appRoot,
      codexControlDirectory: codexDirectory,
      controller,
      development: false,
      port: 0,
    });

    try {
      await server.listen();
      expect(existsSync(capabilityFile)).toBe(true);
      const exitHandler = process
        .listeners("exit")
        .find((listener) => !previousExitListeners.has(listener));
      expect(exitHandler).toBeDefined();
      exitHandler?.(0);
      expect(existsSync(capabilityFile)).toBe(false);
    } finally {
      await server.close();
      rmSync(appRoot, { force: true, recursive: true });
    }
    expect(
      process
        .listeners("exit")
        .every((listener) => previousExitListeners.has(listener))
    ).toBe(true);
  });
});
