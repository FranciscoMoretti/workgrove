import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWorkgroveServer,
  type WorkgroveServerController,
} from "./workgrove-server";

describe("Workgrove HTTP server", () => {
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
});
