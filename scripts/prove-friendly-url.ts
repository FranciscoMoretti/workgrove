import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { WorkgroveConfig } from "../src/config/workgrove-schema";
import type { WorkspaceController } from "../src/controller/workspace-controller";

const require = createRequire(import.meta.url);

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate proxy port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const root = realpathSync(
  mkdtempSync(join(tmpdir(), "workgrove-friendly-url-"))
);
process.env.WORKGROVE_CONTROL_DIR = join(root, "control");
const { CodexHookActivityStore } = await import(
  "../src/codex/codex-hook-activity"
);
const { UnavailableCodexIntegrationAdapter } = await import(
  "../src/codex/codex-integration"
);
const { trustRepository } = await import("../src/config/repository-trust");
const { WorkspaceController: Controller } = await import(
  "../src/controller/workspace-controller"
);
const { PortlessRoutingEngine } = await import("../src/runtime/local-routing");
const { FileWorkgroveStateStore } = await import("../src/runtime/local-state");
const portlessState = join(root, "portless");
const proxyPort = await availablePort();
const config: WorkgroveConfig = {
  version: 1,
  setup: { argv: ["true"] },
  appGroups: {
    web: {
      apps: { site: { protocol: "http", readiness: "tcp" } },
      env: {
        APP_PORT: "{apps.site.port}",
        APP_URL: "{apps.site.url}",
      },
      start: {
        argv: [process.execPath, "proof-server.ts"],
      },
      stop: "process",
    },
  },
};
let controller: WorkspaceController | null = null;
let worktreeId: string | null = null;

try {
  const initialized = spawnSync("git", ["init", "-q"], { cwd: root });
  if (initialized.status !== 0) {
    throw new Error("Could not initialize proof repository");
  }
  writeFileSync(
    join(root, ".workgrove.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
  writeFileSync(
    join(root, "proof-server.ts"),
    "Bun.serve({hostname:'127.0.0.1',port:Number(process.env.APP_PORT),fetch(){return Response.json({port:process.env.APP_PORT,url:process.env.APP_URL})}});\n"
  );
  trustRepository(root, config);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory: portlessState,
  });
  controller = new Controller(new UnavailableCodexIntegrationAdapter(), {
    codexHooks: new CodexHookActivityStore({ persist: false }),
    routing,
    state: new FileWorkgroveStateStore(join(root, "state.json")),
  });

  const before = controller.inspect(root);
  worktreeId = before.worktrees[0].id;
  if (
    before.worktrees[0].apps[0].url !== null ||
    before.worktrees[0].apps[0].port !== null
  ) {
    throw new Error("Friendly URL was exposed before Start");
  }

  await controller.startAppGroup(root, worktreeId, "web");
  const running = controller.inspect(root).worktrees[0].apps[0];
  if (!(running.open && running.url && running.port)) {
    throw new Error("Ready Friendly URL was not exposed after Start");
  }
  const response = await fetch(running.url);
  const body = (await response.json()) as { port?: string; url?: string };
  if (
    !(
      response.ok &&
      body.port === String(running.port) &&
      body.url === running.url
    )
  ) {
    throw new Error(
      "Portless did not proxy the configured environment end to end"
    );
  }

  await controller.stopAppGroup(root, worktreeId, "web");
  const stopped = controller.inspect(root).worktrees[0].apps[0];
  if (stopped.open || stopped.url !== null || stopped.port !== null) {
    throw new Error("Stop left runtime state exposed");
  }
  console.log(
    JSON.stringify(
      {
        body,
        friendlyUrl: running.url,
        port: running.port,
        proxyPort,
        stopped: true,
      },
      null,
      2
    )
  );
} finally {
  if (controller && worktreeId) {
    try {
      await controller.stopAppGroup(root, worktreeId, "web");
    } catch {
      // Preserve the original proof failure.
    }
  }
  spawnSync(
    packageFile("node", "bin", "node"),
    [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
    {
      env: {
        ...process.env,
        PORTLESS_HTTPS: "0",
        PORTLESS_PORT: String(proxyPort),
        PORTLESS_STATE_DIR: portlessState,
        PORTLESS_SYNC_HOSTS: "0",
      },
    }
  );
  rmSync(root, { force: true, recursive: true });
}
