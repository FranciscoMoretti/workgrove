import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { WorkgroveConfig } from "../src/config/workgrove-schema";
import type { WorkspaceController } from "../src/controller/workspace-controller";
import type { AppEndpointSnapshot } from "../src/controller/workspace-snapshot";
import { reserveBackingPort } from "../src/runtime/readiness";

const require = createRequire(import.meta.url);

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function run(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function endpoint(
  worktree: ReturnType<WorkspaceController["inspect"]>["worktrees"][number],
  appId: string
): AppEndpointSnapshot {
  const value = worktree.appGroups[0]?.apps.find((app) => app.id === appId);
  assert(value, `${appId} was not present for ${worktree.path}`);
  return value;
}

const sandbox = realpathSync(
  mkdtempSync(join(tmpdir(), "workgrove-multi-app-routing-"))
);
const root = join(sandbox, "repo");
const linkedPath = join(sandbox, "linked-worktree");
const detachedPath = join(sandbox, "detached-worktree");
process.env.WORKGROVE_CONTROL_DIR = join(sandbox, "control");

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

const portlessState = join(sandbox, "portless");
const proxyReservation = await reserveBackingPort();
const proxyPort = proxyReservation.port;
await proxyReservation.release();
const config: WorkgroveConfig = {
  version: 1,
  setup: { argv: ["true"] },
  appGroups: {
    development: {
      apps: {
        api: { protocol: "http", readiness: "tcp" },
        site: { protocol: "http", readiness: "tcp" },
      },
      env: {
        API_DIRECT_URL: "{apps.api.directUrl}",
        API_PORT: "{apps.api.port}",
        API_URL: "{apps.api.url}",
        SITE_DIRECT_URL: "{apps.site.directUrl}",
        SITE_PORT: "{apps.site.port}",
        SITE_URL: "{apps.site.url}",
      },
      start: { argv: [process.execPath, "proof-server.ts"] },
      stop: "process",
    },
    external: {
      apps: {
        worker: { protocol: "http", readiness: "tcp" },
      },
      env: {
        WORKER_PORT: "{apps.worker.port}",
        WORKER_URL: "{apps.worker.url}",
      },
      start: { argv: [process.execPath, "proof-command-server.ts"] },
      stop: { argv: [process.execPath, "proof-command-stop.ts"] },
    },
  },
};

let controller: WorkspaceController | null = null;
let routing: InstanceType<typeof PortlessRoutingEngine> | null = null;
let conflictServer: ReturnType<typeof createServer> | null = null;
let conflictRoute: { hostname: string; port: number } | null = null;

try {
  run(sandbox, "git", ["init", "-q", root]);
  run(root, "git", ["config", "user.email", "proof@workgrove.local"]);
  run(root, "git", ["config", "user.name", "Workgrove Proof"]);
  writeFileSync(
    join(root, ".workgrove.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
  writeFileSync(
    join(root, "proof-server.ts"),
    `const environment = {
  API_DIRECT_URL: process.env.API_DIRECT_URL,
  API_PORT: process.env.API_PORT,
  API_URL: process.env.API_URL,
  SITE_DIRECT_URL: process.env.SITE_DIRECT_URL,
  SITE_PORT: process.env.SITE_PORT,
  SITE_URL: process.env.SITE_URL,
  cwd: process.cwd(),
};
for (const app of ["api", "site"] as const) {
  Bun.serve({
    hostname: "127.0.0.1",
    port: Number(environment[app === "api" ? "API_PORT" : "SITE_PORT"]),
    fetch() { return Response.json({ app, environment }); },
  });
}
console.log(JSON.stringify(environment));
`
  );
  writeFileSync(
    join(root, "proof-command-server.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync("proof-command.pid", String(process.pid));
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.WORKER_PORT),
  fetch() { return Response.json({ url: process.env.WORKER_URL }); },
});
`
  );
  writeFileSync(
    join(root, "proof-command-stop.ts"),
    `import { readFileSync, writeFileSync } from "node:fs";
const pid = Number(readFileSync("proof-command.pid", "utf8"));
process.kill(pid, "SIGTERM");
writeFileSync("proof-command-stopped", String(pid));
`
  );
  run(root, "git", [
    "add",
    ".workgrove.json",
    "proof-command-server.ts",
    "proof-command-stop.ts",
    "proof-server.ts",
  ]);
  run(root, "git", ["commit", "-qm", "proof fixture"]);
  run(root, "git", ["worktree", "add", "-qb", "proof-linked", linkedPath]);
  run(root, "git", ["worktree", "add", "-q", "--detach", detachedPath, "HEAD"]);

  trustRepository(root, config);
  routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory: portlessState,
  });
  const state = new FileWorkgroveStateStore(join(sandbox, "state.json"));
  controller = new Controller(new UnavailableCodexIntegrationAdapter(), {
    codexHooks: new CodexHookActivityStore({ persist: false }),
    routing,
    state,
  });

  const before = controller.inspect(root);
  assert(
    before.worktrees.length === 3,
    "Git worktrees were not all discovered"
  );
  assert(
    before.worktrees.every((worktree) =>
      worktree.appGroups.every((group) =>
        group.apps.every((app) => !(app.open || app.port || app.url))
      )
    ),
    "A route or Backing endpoint was exposed before Start"
  );

  await Promise.all(
    before.worktrees.map((worktree) =>
      controller?.startAppGroup(root, worktree.id, "development")
    )
  );

  const running = controller.inspect(root);
  const ports = new Set<number>();
  const urls = new Set<string>();
  const worktreePaths = running.worktrees.map((worktree) => worktree.path);
  for (const worktree of running.worktrees) {
    const api = endpoint(worktree, "api");
    const site = endpoint(worktree, "site");
    assert(
      api.open && api.port && api.url,
      `API did not open for ${worktree.path}`
    );
    assert(
      site.open && site.port && site.url,
      `Site did not open for ${worktree.path}`
    );
    for (const app of [api, site]) {
      assert(!ports.has(app.port as number), "Backing ports collided");
      assert(!urls.has(app.url as string), "Friendly URLs collided");
      ports.add(app.port as number);
      urls.add(app.url as string);
      const response = await fetch(app.url as string);
      const body = (await response.json()) as {
        app?: string;
        environment?: Record<string, string>;
      };
      assert(
        response.ok && body.app === app.id,
        `${app.id} routed incorrectly`
      );
      assert(
        body.environment?.API_PORT === String(api.port) &&
          body.environment.API_URL === api.url &&
          body.environment.API_DIRECT_URL === api.directUrl &&
          body.environment.SITE_PORT === String(site.port) &&
          body.environment.SITE_URL === site.url &&
          body.environment.SITE_DIRECT_URL === site.directUrl,
        `${worktree.path} received an incomplete Repository environment`
      );
    }
    const logs = controller.logs(root, worktree.id, "development").join("\n");
    assert(
      logs.includes(worktree.path) &&
        worktreePaths
          .filter((path) => path !== worktree.path)
          .every((path) => !logs.includes(path)),
      `Logs were not isolated for ${worktree.path}`
    );
  }
  assert(
    ports.size === 6 && urls.size === 6,
    "Expected six independent endpoints"
  );

  const linked = running.worktrees.find(
    (worktree) => worktree.path === linkedPath
  );
  assert(linked, "Linked worktree disappeared");
  const linkedUrls = Object.fromEntries(
    linked.appGroups[0]?.apps.map((app) => [app.id, app.url as string]) ?? []
  );
  await controller.stopAppGroup(root, linked.id, "development");
  const afterIndependentStop = controller.inspect(root);
  const stoppedLinked = afterIndependentStop.worktrees.find(
    (worktree) => worktree.path === linkedPath
  );
  assert(
    stoppedLinked?.appGroups[0]?.apps.every(
      (app) => !(app.open || app.port || app.url)
    ),
    "Stopping one worktree left its runtime exposed"
  );
  for (const url of Object.values(linkedUrls)) {
    assert(
      (await fetch(url)).status === 404,
      "A stopped worktree route remained active"
    );
  }
  controller = new Controller(new UnavailableCodexIntegrationAdapter(), {
    codexHooks: new CodexHookActivityStore({ persist: false }),
    routing,
    state: new FileWorkgroveStateStore(join(sandbox, "state.json")),
  });
  await controller.startAppGroup(root, linked.id, "development");
  const restartedLinked = controller
    .inspect(root)
    .worktrees.find((worktree) => worktree.path === linkedPath);
  assert(
    restartedLinked?.appGroups[0]?.apps.every(
      (app) => app.url === linkedUrls[app.id]
    ),
    "Friendly URLs changed after controller reconstruction and restart"
  );
  await controller.stopAppGroup(root, linked.id, "development");
  for (const worktree of afterIndependentStop.worktrees.filter(
    (item) => item.path !== linkedPath
  )) {
    for (const app of worktree.appGroups[0]?.apps ?? []) {
      assert(
        app.url && (await fetch(app.url)).ok,
        "Stopping one worktree affected another"
      );
    }
  }

  for (const worktree of afterIndependentStop.worktrees.filter(
    (item) => item.path !== linkedPath
  )) {
    await controller.stopAppGroup(root, worktree.id, "development");
  }

  const commandWorktree = controller
    .inspect(root)
    .worktrees.find((worktree) => worktree.isMain);
  assert(commandWorktree, "Main worktree disappeared");
  await controller.startAppGroup(root, commandWorktree.id, "external");
  const external = controller
    .inspect(root)
    .worktrees.find((worktree) => worktree.isMain)
    ?.appGroups.find((group) => group.id === "external")?.apps[0];
  assert(
    external?.open && external.url && (await fetch(external.url)).ok,
    "Configured-command App group did not start"
  );
  await controller.stopAppGroup(root, commandWorktree.id, "external");
  assert(
    existsSync(join(root, "proof-command-stopped")),
    "Configured Stop command did not run"
  );

  conflictServer = createServer((socket) => {
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\nConnection: close\r\n\r\nforeign route"
    );
  });
  await new Promise<void>((resolve, reject) => {
    conflictServer?.once("error", reject);
    conflictServer?.listen(0, "127.0.0.1", resolve);
  });
  const conflictAddress = conflictServer.address();
  assert(
    conflictAddress && typeof conflictAddress !== "string",
    "Could not allocate conflict port"
  );
  const conflictPort = conflictAddress.port;
  const mainBeforeConflict = controller
    .inspect(root)
    .worktrees.find((worktree) => worktree.isMain);
  assert(mainBeforeConflict, "Main worktree disappeared");
  const siteAssignment = state.endpoint({
    appId: "site",
    appLabel: "site",
    groupId: "development",
    repoLabel: "repo",
    repoPath: root,
    worktreeLabel: mainBeforeConflict.branch,
    worktreePath: mainBeforeConflict.path,
  });
  conflictRoute = { hostname: siteAssignment.hostname, port: conflictPort };
  await routing.activate(conflictRoute);
  let conflictRejected = false;
  try {
    await controller.startAppGroup(root, mainBeforeConflict.id, "development");
  } catch (error) {
    conflictRejected =
      error instanceof Error && error.message.includes("already routed");
  }
  assert(conflictRejected, "A foreign Friendly URL conflict was not rejected");
  const conflicted = controller
    .inspect(root)
    .worktrees.find((worktree) => worktree.isMain);
  assert(
    conflicted?.appGroups[0]?.apps.every((app) => !(app.open || app.url)),
    "A partial set of Friendly URLs was published after a route conflict"
  );
  await controller.stopAppGroup(root, mainBeforeConflict.id, "development");
  assert(
    routing.observe(conflictRoute) === "active",
    "Stop removed a foreign Portless route"
  );

  console.log(
    JSON.stringify(
      {
        commandStop: true,
        conflictPreserved: true,
        independentStop: true,
        ports: ports.size,
        proxyPort,
        urls: urls.size,
        worktrees: running.worktrees.map((worktree) => ({
          branch: worktree.branch,
          path: worktree.path,
          urls: worktree.appGroups[0]?.apps.map((app) => app.url),
        })),
      },
      null,
      2
    )
  );
} finally {
  if (routing && conflictRoute) {
    try {
      await routing.deactivate(conflictRoute);
    } catch {
      // Preserve the original proof failure.
    }
  }
  if (controller) {
    try {
      for (const worktree of controller.inspect(root).worktrees) {
        for (const groupId of Object.keys(config.appGroups)) {
          await controller.stopAppGroup(root, worktree.id, groupId);
        }
      }
    } catch {
      // Preserve the original proof failure.
    }
  }
  if (conflictServer) {
    await new Promise<void>((resolve) =>
      conflictServer?.close(() => resolve())
    );
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
  rmSync(sandbox, { force: true, recursive: true });
}
