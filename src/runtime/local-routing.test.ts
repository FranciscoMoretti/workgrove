import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PortlessRoutingEngine } from "./local-routing";

const require = createRequire(import.meta.url);

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

it("reloads consecutive Portless route updates", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-portless-watch-"));
  const stateDirectory = join(temporary, "portless");
  const backend = createHttpServer((_request, response) => {
    response.end("ok");
  });
  const proxyReservation = createServer();
  const backendPort = await new Promise<number>((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address();
      if (!address || typeof address === "string") {
        reject(new Error("Backend did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
  const proxyPort = await listen(proxyReservation, 0);
  await close(proxyReservation);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory,
  });

  try {
    await routing.prepare();
    await routing.activate({
      hostname: "first.workgrove.localhost",
      port: backendPort,
    });
    expect(
      routing.observe({
        hostname: "first.workgrove.localhost",
        port: backendPort,
      })
    ).toBe("active");

    await routing.activate({
      hostname: "second.workgrove.localhost",
      port: backendPort,
    });
    expect(
      routing.observe({
        hostname: "second.workgrove.localhost",
        port: backendPort,
      })
    ).toBe("active");
  } finally {
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(proxyPort),
          PORTLESS_STATE_DIR: stateDirectory,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    rmSync(temporary, { force: true, recursive: true });
  }
}, 15_000);
