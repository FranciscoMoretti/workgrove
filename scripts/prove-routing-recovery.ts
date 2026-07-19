import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { WorkgroveConfig } from "../src/config/workgrove-schema";
import type { WorkspaceController } from "../src/controller/workspace-controller";
import { reserveBackingPort } from "../src/runtime/readiness";

interface Finding {
  evidence: unknown;
  name: string;
  outcome: "limitation" | "pass" | "product-gap";
}

const require = createRequire(import.meta.url);
const findings: Finding[] = [];
const HTTP_PROTOCOL = /^http/;

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function run(cwd: string, command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  message: string,
  timeout = 10_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await delay(50);
  }
  throw new Error(message);
}

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function initializeRepository(
  path: string,
  config: WorkgroveConfig,
  files: Record<string, string>
): void {
  mkdirSync(path, { recursive: true });
  run(path, "git", ["init", "-q"]);
  run(path, "git", ["config", "user.email", "proof@workgrove.local"]);
  run(path, "git", ["config", "user.name", "Workgrove Proof"]);
  writeFileSync(
    join(path, ".workgrove.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(path, name), content);
  }
  run(path, "git", ["add", "."]);
  run(path, "git", ["commit", "-qm", "proof fixture"]);
}

async function websocketMessage(url: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url.replace(HTTP_PROTOCOL, "ws"), "vite-hmr");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Vite HMR WebSocket timed out"));
    }, 5000);
    socket.addEventListener("message", (event) => {
      const message = String(event.data);
      if (message.includes('"type":"connected"')) {
        clearTimeout(timer);
        socket.close();
        resolve(message);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Vite HMR WebSocket failed"));
    });
  });
}

const sandbox = realpathSync(
  mkdtempSync(join(tmpdir(), "workgrove-routing-recovery-"))
);
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

const statePath = join(sandbox, "state.json");
const portlessState = join(sandbox, "portless");
const proxyReservation = await reserveBackingPort();
const proxyPort = proxyReservation.port;
await proxyReservation.release();
const routing = new PortlessRoutingEngine({
  port: proxyPort,
  stateDirectory: portlessState,
});
const repositories: Array<{ groups: string[]; path: string }> = [];

function controller(): WorkspaceController {
  return new Controller(new UnavailableCodexIntegrationAdapter(), {
    codexHooks: new CodexHookActivityStore({ persist: false }),
    routing,
    state: new FileWorkgroveStateStore(statePath),
  });
}

function stopProxy(): void {
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
}

try {
  const labelRequest = (repoPath: string, worktreePath: string) => ({
    appId: "web",
    appLabel: "Web",
    groupId: "development",
    repoLabel: "shared",
    repoPath,
    worktreeLabel: "main",
    worktreePath,
  });
  const firstState = new FileWorkgroveStateStore(
    join(sandbox, "labels-first.json")
  );
  const firstA = firstState.endpoint(
    labelRequest("/proof/one/shared", "/proof/one/shared")
  );
  const firstB = firstState.endpoint(
    labelRequest("/proof/two/shared", "/proof/two/shared")
  );
  const reverseState = new FileWorkgroveStateStore(
    join(sandbox, "labels-reverse.json")
  );
  const reverseB = reverseState.endpoint(
    labelRequest("/proof/two/shared", "/proof/two/shared")
  );
  const reverseA = reverseState.endpoint(
    labelRequest("/proof/one/shared", "/proof/one/shared")
  );
  findings.push({
    evidence: {
      firstOrder: [firstA.hostname, firstB.hostname],
      reverseOrder: [reverseA.hostname, reverseB.hostname],
    },
    name: "duplicate repository route labels",
    outcome:
      firstA.hostname === reverseA.hostname &&
      firstB.hostname === reverseB.hostname
        ? "pass"
        : "product-gap",
  });

  const renamedBranch = firstState.endpoint({
    ...labelRequest("/proof/one/shared", "/proof/one/shared"),
    worktreeLabel: "renamed-main",
  });
  const movedWorktree = firstState.endpoint({
    ...labelRequest("/proof/one/shared", "/proof/one/moved"),
    worktreeLabel: "renamed-main",
    worktreePath: "/proof/one/moved",
  });
  findings.push({
    evidence: {
      afterBranchRename: renamedBranch.hostname,
      afterPathMove: movedWorktree.hostname,
      before: firstA.hostname,
    },
    name: "branch rename retains identity",
    outcome:
      renamedBranch.hostname === firstA.hostname ? "pass" : "product-gap",
  });
  findings.push({
    evidence: {
      afterPathMove: movedWorktree.hostname,
      before: firstA.hostname,
    },
    name: "worktree path move retains identity",
    outcome: movedWorktree.hostname === firstA.hostname ? "pass" : "limitation",
  });

  const partialRoot = join(sandbox, "partial-repository");
  const partialConfig: WorkgroveConfig = {
    version: 1,
    setup: { argv: ["true"] },
    appGroups: {
      development: {
        apps: {
          ready: {
            protocol: "http",
            readiness: {
              path: "/",
              statuses: "200-399",
              timeoutSeconds: 2,
              type: "http",
            },
          },
          waiting: {
            protocol: "http",
            readiness: {
              path: "/",
              statuses: "200-399",
              timeoutSeconds: 2,
              type: "http",
            },
          },
        },
        env: {
          READY_PORT: "{apps.ready.port}",
        },
        start: { argv: [process.execPath, "partial-server.ts"] },
        stop: "process",
      },
    },
  };
  initializeRepository(partialRoot, partialConfig, {
    "partial-server.ts":
      "Bun.serve({hostname:'127.0.0.1',port:Number(process.env.READY_PORT),fetch(){return new Response('ready')}});\n",
  });
  repositories.push({ groups: ["development"], path: partialRoot });
  trustRepository(partialRoot, partialConfig);
  const partialController = controller();
  const partialWorktree = partialController.inspect(partialRoot).worktrees[0];
  let partialStartError = "";
  try {
    await partialController.startAppGroup(
      partialRoot,
      partialWorktree.id,
      "development"
    );
  } catch (error) {
    partialStartError = error instanceof Error ? error.message : String(error);
  }
  const partialGroup = partialController
    .inspect(partialRoot)
    .worktrees[0].appGroups.find((group) => group.id === "development");
  const readyApp = partialGroup?.apps.find((app) => app.id === "ready");
  findings.push({
    evidence: {
      groupHealth: partialGroup?.health,
      readyApp: {
        readiness: readyApp?.readiness,
        routeState: readyApp?.routeState,
        url: readyApp?.url,
      },
      startError: partialStartError,
    },
    name: "partial readiness publishes ready app",
    outcome:
      partialGroup?.health === "partially-running" && readyApp?.url
        ? "pass"
        : "product-gap",
  });
  await partialController.stopAppGroup(
    partialRoot,
    partialWorktree.id,
    "development"
  );

  const foreignPortRoot = join(sandbox, "foreign-port-repository");
  const foreignPortConfig: WorkgroveConfig = {
    version: 1,
    setup: { argv: ["true"] },
    appGroups: {
      development: {
        apps: {
          site: { protocol: "http", readiness: "tcp" },
        },
        start: { argv: [process.execPath, "should-not-start.ts"] },
        stop: "process",
      },
    },
  };
  initializeRepository(foreignPortRoot, foreignPortConfig, {
    "should-not-start.ts":
      "import { writeFileSync } from 'node:fs'; writeFileSync('unexpected-start', 'started');\n",
  });
  repositories.push({ groups: ["development"], path: foreignPortRoot });
  trustRepository(foreignPortRoot, foreignPortConfig);
  const foreignPortController = controller();
  const foreignPortWorktree =
    foreignPortController.inspect(foreignPortRoot).worktrees[0];
  const foreignReservation = await reserveBackingPort();
  const foreignBackingPort = foreignReservation.port;
  await foreignReservation.release();
  const foreignServer = createServer((socket) => {
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nforeign"
    );
  });
  await new Promise<void>((resolve, reject) => {
    foreignServer.once("error", reject);
    foreignServer.listen(foreignBackingPort, "127.0.0.1", resolve);
  });
  const foreignState = new FileWorkgroveStateStore(statePath);
  const foreignAssignment = foreignState.endpoint({
    appId: "site",
    appLabel: "site",
    groupId: "development",
    repoLabel: basename(foreignPortRoot),
    repoPath: foreignPortRoot,
    worktreeLabel: foreignPortWorktree.branch,
    worktreePath: foreignPortRoot,
  });
  foreignState.saveRun(
    {
      groupId: "development",
      repoPath: foreignPortRoot,
      worktreePath: foreignPortRoot,
    },
    {
      apps: {
        site: {
          appId: "site",
          directUrl: `http://127.0.0.1:${foreignBackingPort}`,
          host: "127.0.0.1",
          hostname: foreignAssignment.hostname,
          port: foreignBackingPort,
          protocol: "http",
          url: routing.url(foreignAssignment.hostname),
        },
      },
      createdAt: new Date().toISOString(),
      groupId: "development",
    }
  );
  let foreignStartError = "";
  try {
    await foreignPortController.startAppGroup(
      foreignPortRoot,
      foreignPortWorktree.id,
      "development"
    );
  } catch (error) {
    foreignStartError = error instanceof Error ? error.message : String(error);
  }
  const foreignSnapshot =
    foreignPortController.inspect(foreignPortRoot).worktrees[0].appGroups[0];
  let foreignStopError = "";
  try {
    await foreignPortController.stopAppGroup(
      foreignPortRoot,
      foreignPortWorktree.id,
      "development"
    );
  } catch (error) {
    foreignStopError = error instanceof Error ? error.message : String(error);
  }
  findings.push({
    evidence: {
      processRunning: foreignSnapshot?.processRunning,
      routeState: foreignSnapshot?.apps[0]?.routeState,
      startCommandExecuted: existsSync(
        join(foreignPortRoot, "unexpected-start")
      ),
      startError: foreignStartError,
      stopError: foreignStopError,
    },
    name: "foreign Backing port conflict and quarantine",
    outcome:
      foreignStartError.includes("outside this worktree") &&
      !foreignSnapshot?.processRunning &&
      !existsSync(join(foreignPortRoot, "unexpected-start")) &&
      foreignStopError.includes("remain quarantined")
        ? "pass"
        : "product-gap",
  });
  await new Promise<void>((resolve) => foreignServer.close(() => resolve()));
  await foreignPortController.stopAppGroup(
    foreignPortRoot,
    foreignPortWorktree.id,
    "development"
  );

  const viteRoot = join(sandbox, "vite-repository");
  const viteConfig: WorkgroveConfig = {
    version: 1,
    setup: { argv: ["true"] },
    appGroups: {
      development: {
        apps: {
          site: {
            protocol: "http",
            readiness: {
              path: "/",
              statuses: "200-399",
              timeoutSeconds: 10,
              type: "http",
            },
          },
        },
        start: {
          argv: [
            packageFile("node", "bin", "node"),
            packageFile("vite", "bin", "vite.js"),
            "--host",
            "127.0.0.1",
            "--port",
            "{apps.site.port}",
            "--strictPort",
          ],
        },
        stop: "process",
      },
    },
  };
  initializeRepository(viteRoot, viteConfig, {
    "index.html": "<main>Workgrove Vite recovery proof</main>\n",
  });
  repositories.push({ groups: ["development"], path: viteRoot });
  trustRepository(viteRoot, viteConfig);
  let viteController = controller();
  const viteWorktree = viteController.inspect(viteRoot).worktrees[0];
  await viteController.startAppGroup(viteRoot, viteWorktree.id, "development");
  let viteApp =
    viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0];
  assert(viteApp?.url, "Vite Friendly URL was not published");
  const viteHtml = await (await fetch(viteApp.url)).text();
  const hmrMessage = await websocketMessage(viteApp.url);
  findings.push({
    evidence: {
      hmrMessage,
      html: viteHtml.includes("Workgrove Vite recovery proof"),
      url: viteApp.url,
    },
    name: "Vite HTTP and HMR WebSocket",
    outcome: "pass",
  });

  const friendlyBeforeProxyCrash = viteApp.url;
  const proxyPid = Number(
    readFileSync(join(portlessState, "proxy.pid"), "utf8").trim()
  );
  process.kill(proxyPid, "SIGTERM");
  await waitUntil(
    () => !processIsLive(proxyPid),
    "Portless proxy did not stop after crash"
  );
  const duringProxyCrash =
    viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0];
  const processBeforeProxyRecovery = viteController
    .inspect(viteRoot)
    .globalProcesses.find((item) => item.cwd === viteRoot)?.pid;
  await viteController.startAppGroup(viteRoot, viteWorktree.id, "development");
  viteApp = viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0];
  const processAfterProxyRecovery = viteController
    .inspect(viteRoot)
    .globalProcesses.find((item) => item.cwd === viteRoot)?.pid;
  findings.push({
    evidence: {
      processPreserved:
        processBeforeProxyRecovery === processAfterProxyRecovery,
      routeDuringCrash: duringProxyCrash?.routeState,
      routeAfterRetry: viteApp?.routeState,
      sameUrl: viteApp?.url === friendlyBeforeProxyCrash,
    },
    name: "Portless proxy crash and route retry",
    outcome:
      duringProxyCrash?.routeState === "unavailable" &&
      viteApp?.open &&
      viteApp.url === friendlyBeforeProxyCrash &&
      processBeforeProxyRecovery === processAfterProxyRecovery
        ? "pass"
        : "product-gap",
  });

  const originalFriendlyUrl = viteApp?.url;
  const originalBackingPort = viteApp?.port;
  const vitePid = processAfterProxyRecovery;
  assert(vitePid, "Vite managed process was not recorded");
  process.kill(-vitePid, "SIGKILL");
  await waitUntil(() => !processIsLive(vitePid), "Vite process did not crash");
  await waitUntil(
    () =>
      viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0]
        ?.readiness === "unready",
    "Vite crash was not observed"
  );
  const afterAppCrash =
    viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0];
  await viteController.startAppGroup(viteRoot, viteWorktree.id, "development");
  const afterAppRestart =
    viteController.inspect(viteRoot).worktrees[0].appGroups[0].apps[0];
  findings.push({
    evidence: {
      afterCrash: {
        readiness: afterAppCrash?.readiness,
        routeState: afterAppCrash?.routeState,
        url: afterAppCrash?.url,
      },
      afterStart: {
        backingPort: afterAppRestart?.port,
        open: afterAppRestart?.open,
        url: afterAppRestart?.url,
      },
      originalBackingPort,
      originalFriendlyUrl,
    },
    name: "app crash observation and manual Start recovery",
    outcome:
      afterAppCrash?.readiness === "unready" &&
      afterAppRestart?.open &&
      afterAppRestart.url === originalFriendlyUrl
        ? "pass"
        : "product-gap",
  });
  findings.push({
    evidence: {
      readiness: afterAppCrash?.readiness,
      routeState: afterAppCrash?.routeState,
    },
    name: "route state verifies a reachable backing app",
    outcome:
      afterAppCrash?.readiness === "unready" &&
      afterAppCrash.routeState === "active"
        ? "product-gap"
        : "pass",
  });
  await viteController.stopAppGroup(viteRoot, viteWorktree.id, "development");

  const harnessPath = join(sandbox, "start-harness.ts");
  const readyMarker = join(sandbox, "harness-ready.json");
  const workgroveRoot = dirname(dirname(import.meta.path));
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
  state: new FileWorkgroveStateStore(${JSON.stringify(statePath)}),
});
const worktree = controller.inspect(${JSON.stringify(viteRoot)}).worktrees[0];
await controller.startAppGroup(${JSON.stringify(viteRoot)}, worktree.id, "development");
writeFileSync(${JSON.stringify(readyMarker)}, JSON.stringify(controller.inspect(${JSON.stringify(viteRoot)}).globalProcesses));
setInterval(() => {}, 1000);
`
  );
  const harness = spawn(process.execPath, [harnessPath], {
    detached: false,
    env: process.env,
    stdio: "ignore",
  });
  assert(harness.pid, "Recovery harness did not start");
  await waitUntil(
    () => existsSync(readyMarker),
    "Recovery harness did not start the App group",
    20_000
  );
  const harnessProcesses = JSON.parse(
    readFileSync(readyMarker, "utf8")
  ) as Array<{ pid: number }>;
  const survivingPid = harnessProcesses[0]?.pid;
  assert(survivingPid, "Recovery harness did not record the managed process");
  process.kill(harness.pid, "SIGKILL");
  await waitUntil(
    () => !processIsLive(harness.pid as number),
    "Recovery harness did not crash"
  );
  assert(
    processIsLive(survivingPid),
    "Managed app did not survive daemon crash"
  );
  viteController = controller();
  const adopted = viteController.inspect(viteRoot);
  const adoptedApp = adopted.worktrees[0].appGroups[0].apps[0];
  const adoptedProcess = adopted.globalProcesses.find(
    (item) => item.pid === survivingPid
  );
  findings.push({
    evidence: {
      appOpen: adoptedApp?.open,
      processListed: Boolean(adoptedProcess),
      survivingPid,
    },
    name: "surviving process re-adoption after daemon crash",
    outcome: adoptedApp?.open && adoptedProcess ? "pass" : "product-gap",
  });
  await viteController.stopAppGroup(
    viteRoot,
    adopted.worktrees[0].id,
    "development"
  );

  stopProxy();
  const occupyingServer = createServer((socket) => {
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nforeign"
    );
  });
  await new Promise<void>((resolve, reject) => {
    occupyingServer.once("error", reject);
    occupyingServer.listen(proxyPort, "127.0.0.1", resolve);
  });
  let unavailableStart = "returned";
  try {
    await viteController.startAppGroup(
      viteRoot,
      adopted.worktrees[0].id,
      "development"
    );
  } catch (error) {
    unavailableStart = error instanceof Error ? error.message : String(error);
  }
  const afterUnavailableStart = viteController.inspect(viteRoot);
  const unavailableGroup = afterUnavailableStart.worktrees[0].appGroups[0];
  findings.push({
    evidence: {
      processRunning: unavailableGroup?.processRunning,
      routeState: unavailableGroup?.apps[0]?.routeState,
      startOutcome: unavailableStart,
      url: unavailableGroup?.apps[0]?.url,
    },
    name: "Portless preflight precedes repository Start",
    outcome: unavailableGroup?.processRunning ? "product-gap" : "pass",
  });
  await new Promise<void>((resolve) => occupyingServer.close(() => resolve()));
  try {
    await viteController.startAppGroup(
      viteRoot,
      adopted.worktrees[0].id,
      "development"
    );
  } catch {
    // A following Stop still proves cleanup after an unavailable proxy.
  }

  const routesPath = join(portlessState, "routes.json");
  const routesBeforeCorruption = readFileSync(routesPath, "utf8");
  writeFileSync(routesPath, "not-json\n");
  let corruptedStateOutcome = "inspect returned";
  try {
    viteController.inspect(viteRoot);
  } catch (error) {
    corruptedStateOutcome =
      error instanceof Error ? error.message : String(error);
  }
  writeFileSync(routesPath, routesBeforeCorruption);
  findings.push({
    evidence: { inspectOutcome: corruptedStateOutcome },
    name: "invalid Portless state is isolated to route diagnostics",
    outcome:
      corruptedStateOutcome === "inspect returned" ? "pass" : "product-gap",
  });
  try {
    await viteController.stopAppGroup(
      viteRoot,
      adopted.worktrees[0].id,
      "development"
    );
  } catch {
    await viteController.stopAppGroup(
      viteRoot,
      adopted.worktrees[0].id,
      "development"
    );
  }

  findings.push({
    evidence: {
      friendlyUrl: routing.url("proof.localhost"),
      mode: "PortlessRoutingEngine forces --no-tls and PORTLESS_HTTPS=0",
    },
    name: "Workgrove HTTPS and certificate behavior",
    outcome: "limitation",
  });

  console.log(
    JSON.stringify(
      {
        findings,
        summary: Object.fromEntries(
          ["pass", "product-gap", "limitation"].map((outcome) => [
            outcome,
            findings.filter((finding) => finding.outcome === outcome).length,
          ])
        ),
      },
      null,
      2
    )
  );
} finally {
  for (const repository of repositories) {
    if (!existsSync(repository.path)) {
      continue;
    }
    try {
      const cleanupController = controller();
      const snapshot = cleanupController.inspect(repository.path);
      for (const worktree of snapshot.worktrees) {
        for (const group of repository.groups) {
          try {
            await cleanupController.stopAppGroup(
              repository.path,
              worktree.id,
              group
            );
          } catch {
            // Preserve the original verification failure.
          }
        }
      }
    } catch {
      // Preserve the original verification failure.
    }
  }
  stopProxy();
  rmSync(sandbox, { force: true, recursive: true });
}
