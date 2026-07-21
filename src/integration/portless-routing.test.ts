import { test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { WorkgroveConfig } from "../config/workgrove-schema";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { AppEndpointSnapshot } from "../controller/workspace-snapshot";
import { reserveBackingPort } from "../runtime/readiness";

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

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  condition: () => boolean,
  message: string,
  timeout = 10_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function endpoint(
  worktree: ReturnType<WorkspaceController["inspect"]>["worktrees"][number],
  appId: string
): AppEndpointSnapshot {
  const value = worktree.appGroups[0]?.apps.find((app) => app.id === appId);
  assert(value, `${appId} was not present for ${worktree.path}`);
  return value;
}

test("routes multiple apps and worktrees through an isolated Portless runtime", async () => {
  const sandbox = realpathSync(
    mkdtempSync(join(tmpdir(), "workgrove-portless-integration-"))
  );
  const root = join(sandbox, "repo");
  const linkedPath = join(sandbox, "linked-worktree");
  const detachedPath = join(sandbox, "detached-worktree");
  const previousControlDirectory = process.env.WORKGROVE_CONTROL_DIR;
  process.env.WORKGROVE_CONTROL_DIR = join(sandbox, "control");

  const { CodexHookActivityStore } = await import(
    "../codex/codex-hook-activity"
  );
  const { UnavailableCodexIntegrationAdapter } = await import(
    "../codex/codex-integration"
  );
  const { trustRepository } = await import("../config/repository-trust");
  const { WorkspaceController: Controller } = await import(
    "../controller/workspace-controller"
  );
  const { PortlessRoutingEngine } = await import("../runtime/local-routing");
  const { FileWorkgroveStateStore } = await import("../runtime/local-state");

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
        start: { argv: [process.execPath, "integration-server.ts"] },
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
        start: { argv: [process.execPath, "integration-command-server.ts"] },
        stop: { argv: [process.execPath, "integration-command-stop.ts"] },
      },
    },
  };

  let controller: WorkspaceController | null = null;
  let routing: InstanceType<typeof PortlessRoutingEngine> | null = null;
  let conflictServer: ReturnType<typeof createServer> | null = null;
  let conflictRoute: { hostname: string; port: number } | null = null;
  let recoveryHarness: ReturnType<typeof spawn> | null = null;

  try {
    run(sandbox, "git", ["init", "-q", root]);
    run(root, "git", ["config", "user.email", "test@workgrove.local"]);
    run(root, "git", ["config", "user.name", "Workgrove Integration Test"]);
    writeFileSync(
      join(root, ".workgrove.json"),
      `${JSON.stringify(config, null, 2)}\n`
    );
    writeFileSync(
      join(root, "integration-server.ts"),
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
      join(root, "integration-command-server.ts"),
      `import { writeFileSync } from "node:fs";
writeFileSync("integration-command.pid", String(process.pid));
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.WORKER_PORT),
  fetch() { return Response.json({ url: process.env.WORKER_URL }); },
});
`
    );
    writeFileSync(
      join(root, "integration-command-stop.ts"),
      `import { readFileSync, writeFileSync } from "node:fs";
const pid = Number(readFileSync("integration-command.pid", "utf8"));
process.kill(pid, "SIGTERM");
writeFileSync("integration-command-stopped", String(pid));
`
    );
    run(root, "git", [
      "add",
      ".workgrove.json",
      "integration-command-server.ts",
      "integration-command-stop.ts",
      "integration-server.ts",
    ]);
    run(root, "git", ["commit", "-qm", "integration fixture"]);
    run(root, "git", [
      "worktree",
      "add",
      "-qb",
      "integration-linked",
      linkedPath,
    ]);
    run(root, "git", [
      "worktree",
      "add",
      "-q",
      "--detach",
      detachedPath,
      "HEAD",
    ]);

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

    const workgroveRoot = dirname(dirname(import.meta.dir));
    const harnessPath = join(sandbox, "recovery-harness.ts");
    const readyMarker = join(sandbox, "recovery-ready.json");
    writeFileSync(
      harnessPath,
      `process.env.WORKGROVE_CONTROL_DIR = ${JSON.stringify(process.env.WORKGROVE_CONTROL_DIR)};
const { CodexHookActivityStore } = await import(${JSON.stringify(join(workgroveRoot, "src/codex/codex-hook-activity.ts"))});
const { UnavailableCodexIntegrationAdapter } = await import(${JSON.stringify(join(workgroveRoot, "src/codex/codex-integration.ts"))});
const { WorkspaceController } = await import(${JSON.stringify(join(workgroveRoot, "src/controller/workspace-controller.ts"))});
const { PortlessRoutingEngine } = await import(${JSON.stringify(join(workgroveRoot, "src/runtime/local-routing.ts"))});
const { FileWorkgroveStateStore } = await import(${JSON.stringify(join(workgroveRoot, "src/runtime/local-state.ts"))});
const { writeFileSync } = await import("node:fs");
const controller = new WorkspaceController(new UnavailableCodexIntegrationAdapter(), {
  codexHooks: new CodexHookActivityStore({ persist: false }),
  routing: new PortlessRoutingEngine({ port: ${proxyPort}, stateDirectory: ${JSON.stringify(portlessState)} }),
  state: new FileWorkgroveStateStore(${JSON.stringify(join(sandbox, "state.json"))}),
});
const worktree = controller.inspect(${JSON.stringify(root)}).worktrees.find((item) => item.isMain);
if (!worktree) throw new Error("Main worktree disappeared");
await controller.startAppGroup(${JSON.stringify(root)}, worktree.id, "development");
writeFileSync(${JSON.stringify(readyMarker)}, JSON.stringify(controller.inspect(${JSON.stringify(root)}).globalProcesses));
setInterval(() => {}, 1000);
`
    );
    recoveryHarness = spawn(process.execPath, [harnessPath], {
      env: process.env,
      stdio: "ignore",
    });
    assert(recoveryHarness.pid, "Recovery harness did not start");
    await waitUntil(
      () => existsSync(readyMarker),
      "Recovery harness did not start the App group",
      20_000
    );
    const harnessProcesses = JSON.parse(
      readFileSync(readyMarker, "utf8")
    ) as Array<{ cwd: string; pid: number }>;
    const survivingPid = harnessProcesses.find(
      (item) => item.cwd === root
    )?.pid;
    assert(survivingPid, "Recovery harness did not record the managed process");
    process.kill(recoveryHarness.pid, "SIGKILL");
    await waitUntil(
      () => !processIsLive(recoveryHarness?.pid as number),
      "Recovery harness did not stop"
    );
    recoveryHarness = null;
    assert(
      processIsLive(survivingPid),
      "Managed App did not survive daemon exit"
    );

    controller = new Controller(new UnavailableCodexIntegrationAdapter(), {
      codexHooks: new CodexHookActivityStore({ persist: false }),
      routing,
      state: new FileWorkgroveStateStore(join(sandbox, "state.json")),
    });
    const adopted = controller.inspect(root);
    const adoptedGroup = adopted.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      adoptedGroup?.apps.every((app) => app.open) &&
        adopted.globalProcesses.some((item) => item.pid === survivingPid),
      "A surviving managed process was not re-adopted"
    );
    await controller.stopAppGroup(root, commandWorktree.id, "development");

    await controller.startAppGroup(root, commandWorktree.id, "development");
    const beforeProxyCrash = controller.inspect(root);
    const beforeCrashGroup = beforeProxyCrash.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    const processBeforeRecovery = beforeProxyCrash.globalProcesses.find(
      (item) => item.cwd === root
    )?.pid;
    const urlsBeforeRecovery = Object.fromEntries(
      beforeCrashGroup?.apps.map((app) => [app.id, app.url]) ?? []
    );
    const proxyPid = Number(
      readFileSync(join(portlessState, "proxy.pid"), "utf8").trim()
    );
    process.kill(proxyPid, "SIGTERM");
    await waitUntil(
      () => !processIsLive(proxyPid),
      "Portless proxy did not stop"
    );
    const duringProxyCrash = controller
      .inspect(root)
      .worktrees.find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      duringProxyCrash?.apps.every((app) => app.routeState === "unavailable"),
      "A stopped Portless proxy was not observed as unavailable"
    );
    await controller.startAppGroup(root, commandWorktree.id, "development");
    const afterProxyRecovery = controller.inspect(root);
    const recoveredGroup = afterProxyRecovery.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      recoveredGroup?.apps.every(
        (app) => app.open && app.url === urlsBeforeRecovery[app.id]
      ) &&
        afterProxyRecovery.globalProcesses.find((item) => item.cwd === root)
          ?.pid === processBeforeRecovery,
      "Route retry did not preserve the process and Friendly URLs"
    );
    await controller.stopAppGroup(root, commandWorktree.id, "development");

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
      existsSync(join(root, "integration-command-stopped")),
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
      await controller.startAppGroup(
        root,
        mainBeforeConflict.id,
        "development"
      );
    } catch (error) {
      conflictRejected =
        error instanceof Error && error.message.includes("already routed");
    }
    assert(
      conflictRejected,
      "A foreign Friendly URL conflict was not rejected"
    );
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
  } finally {
    if (recoveryHarness?.pid && processIsLive(recoveryHarness.pid)) {
      process.kill(recoveryHarness.pid, "SIGKILL");
    }
    if (routing && conflictRoute) {
      try {
        await routing.deactivate(conflictRoute);
      } catch {
        // Preserve the original test failure.
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
        // Preserve the original test failure.
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
    if (previousControlDirectory === undefined) {
      process.env.WORKGROVE_CONTROL_DIR = undefined;
    } else {
      process.env.WORKGROVE_CONTROL_DIR = previousControlDirectory;
    }
  }
}, 120_000);
