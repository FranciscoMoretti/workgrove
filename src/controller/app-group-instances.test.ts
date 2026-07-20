import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocalRoute, LocalRoutingEngine } from "../runtime/local-routing";
import { FileWorkgroveStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { WorkspaceController } from "./workspace-controller";

class InMemoryRoutingEngine implements LocalRoutingEngine {
  private readonly routes = new Map<string, number>();
  prepared = false;

  activate(route: LocalRoute): Promise<void> {
    if (!this.prepared) {
      throw new Error("Routing activated before preflight");
    }
    this.routes.set(route.hostname, route.port);
    return Promise.resolve();
  }

  deactivate(route: LocalRoute): Promise<void> {
    this.routes.delete(route.hostname);
    return Promise.resolve();
  }

  observe(route: LocalRoute) {
    const port = this.routes.get(route.hostname);
    if (port === undefined) {
      return "inactive" as const;
    }
    return port === route.port ? ("active" as const) : ("conflict" as const);
  }

  prepare(): Promise<void> {
    this.prepared = true;
    return Promise.resolve();
  }

  point(hostname: string, port: number): void {
    this.routes.set(hostname, port);
  }

  url(hostname: string): string {
    return `http://${hostname}:1355`;
  }
}

class FailingPrepareRoutingEngine extends InMemoryRoutingEngine {
  override prepare(): Promise<void> {
    return Promise.reject(new Error("Portless unavailable"));
  }
}

class RecoverableActivationRoutingEngine extends InMemoryRoutingEngine {
  private failing = true;

  override activate(route: LocalRoute): Promise<void> {
    return this.failing
      ? Promise.reject(new Error("Portless route activation failed"))
      : super.activate(route);
  }

  recover(): void {
    this.failing = false;
  }
}

class TrustedWorkspaceController extends WorkspaceController {
  override assertTrusted(): void {
    // This fixture controls every command and does not touch repository trust.
  }
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("App-group instance assignment", () => {
  it("shares selectable defaults and lets one worktree switch to an isolated instance", () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-instances-"));
    const repository = join(temporary, "project");
    const featureWorktree = join(temporary, "project-feature");
    mkdirSync(repository);
    try {
      git(repository, "init", "-q");
      git(repository, "config", "user.email", "workgrove@example.test");
      git(repository, "config", "user.name", "Workgrove Test");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: { argv: ["true"] },
              stop: "process",
              apps: { Web: { protocol: "http" } },
            },
            Services: {
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      git(repository, "add", ".workgrove.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      const controller = new WorkspaceController(undefined, {
        routing: new InMemoryRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      const initial = controller.inspect(repository);
      const main = initial.worktrees.find((worktree) => worktree.isMain);
      const feature = initial.worktrees.find((worktree) => !worktree.isMain);
      expect(main).toBeDefined();
      expect(feature).toBeDefined();

      const mainApps = main?.appGroups.find((group) => group.id === "Apps");
      const featureApps = feature?.appGroups.find(
        (group) => group.id === "Apps"
      );
      expect(mainApps?.instance.mode).toBe("per-worktree");
      expect(mainApps?.instance.id).not.toBe(featureApps?.instance.id);

      const mainServices = main?.appGroups.find(
        (group) => group.id === "Services"
      );
      const featureServices = feature?.appGroups.find(
        (group) => group.id === "Services"
      );
      expect(mainServices?.instance.name).toBe("Default");
      expect(mainServices?.instance.id).toBe(featureServices?.instance.id);

      controller.createAppGroupInstance(
        repository,
        feature?.id ?? "",
        "Services",
        "Migration experiment"
      );
      const isolated = controller.inspect(repository);
      const isolatedMain = isolated.worktrees
        .find((worktree) => worktree.isMain)
        ?.appGroups.find((group) => group.id === "Services");
      const isolatedFeature = isolated.worktrees
        .find((worktree) => !worktree.isMain)
        ?.appGroups.find((group) => group.id === "Services");

      expect(isolatedMain?.instance.name).toBe("Default");
      expect(isolatedFeature?.instance.name).toBe("Migration experiment");
      expect(
        isolatedFeature?.instances.map((instance) => instance.name)
      ).toEqual(["Default", "Migration experiment"]);

      controller.selectAppGroupInstance(
        repository,
        feature?.id ?? "",
        "Services",
        isolatedMain?.instance.id ?? ""
      );
      const sharedAgain = controller.inspect(repository);
      expect(
        sharedAgain.worktrees
          .find((worktree) => !worktree.isMain)
          ?.appGroups.find((group) => group.id === "Services")?.instance.id
      ).toBe(isolatedMain?.instance.id);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("materializes cross-group ports before Start and keeps them stable across Restart", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-runtime-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    let blocker: Server | null = null;
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');const http=require('node:http');fs.writeFileSync('resolved-env.txt',process.env.DATABASE_PORT+'\\n'+process.env.WEB_PORT);http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: {
                DATABASE_PORT: "{appGroups.Services.apps.Database.port}",
                SLOW_PORT: "{apps.Slow.port}",
                WEB_PORT: "{apps.Web.port}",
              },
              apps: {
                Slow: {
                  protocol: "http",
                  readiness: {
                    path: "/",
                    statuses: "200-399",
                    timeoutSeconds: 1,
                    type: "http",
                  },
                },
                Web: { protocol: "http" },
              },
            },
            Services: {
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      const routing = new InMemoryRoutingEngine();
      controller = new TrustedWorkspaceController(undefined, {
        routing,
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(routing.prepared).toBe(true);
      const running = controller.inspect(repository).worktrees[0];
      expect(
        running?.appGroups.find((group) => group.id === "Apps")?.health
      ).toBe("partially-running");
      const webPort = running?.appGroups
        .find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      const databasePort = running?.appGroups
        .find((group) => group.id === "Services")
        ?.apps.find((app) => app.id === "Database")?.port;
      expect(webPort).toBeNumber();
      expect(databasePort).toBeNumber();
      expect(
        readFileSync(join(repository, "resolved-env.txt"), "utf8").split("\n")
      ).toEqual([String(databasePort), String(webPort)]);

      blocker = createServer();
      await listen(blocker, databasePort as number);
      await expect(
        controller.startAppGroup(repository, worktreeId, "Services")
      ).rejects.toThrow("occupied by an unrelated process");
      await close(blocker);
      blocker = null;

      expect(
        await controller.stopAppGroup(repository, worktreeId, "Apps")
      ).toBe("stopped");
      const stoppedPort = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      expect(stoppedPort).toBe(webPort);

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(
        controller
          .inspect(repository)
          .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
          ?.apps.find((app) => app.id === "Web")?.port
      ).toBe(webPort);

      const webHostname = new URL(
        controller
          .inspect(repository)
          .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
          ?.apps.find((app) => app.id === "Web")?.url ?? ""
      ).hostname;
      routing.point(webHostname, (webPort as number) + 1);
      await expect(
        controller.stopAppGroup(repository, worktreeId, "Apps")
      ).rejects.toThrow("points to a different Backing endpoint");
      routing.point(webHostname, webPort as number);
      expect(
        await controller.stopAppGroup(repository, worktreeId, "Apps")
      ).toBe("stopped");
    } finally {
      if (blocker) {
        await close(blocker).catch(() => undefined);
      }
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 15_000);

  it("fails Portless preflight before executing repository code", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-preflight-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:fs').writeFileSync('started.txt','yes')",
                ],
              },
              stop: "process",
              apps: { Web: { protocol: "http" } },
            },
          },
        })
      );
      const controller = new TrustedWorkspaceController(undefined, {
        routing: new FailingPrepareRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      const id = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, id, "Apps")
      ).rejects.toThrow("Portless unavailable");
      expect(existsSync(join(repository, "started.txt"))).toBe(false);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("keeps a ready process available for diagnostics when routing fails", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-routing-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:http').createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: { WEB_PORT: "{apps.Web.port}" },
              apps: { Web: { protocol: "http" } },
            },
          },
        })
      );
      const routing = new RecoverableActivationRoutingEngine();
      controller = new TrustedWorkspaceController(undefined, {
        routing,
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, worktreeId, "Apps")
      ).rejects.toThrow("Portless route activation failed");
      const endpoint = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web");
      expect(endpoint?.readiness).toBe("ready");
      expect(endpoint?.routeState).toBe("unavailable");
      expect(endpoint?.directUrl).toStartWith("http://127.0.0.1:");
      expect(endpoint?.open).toBe(false);

      routing.recover();
      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      const recovered = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web");
      expect(recovered?.routeState).toBe("active");
      expect(recovered?.open).toBe(true);
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("retries readiness for a sibling that already owns its backing port", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-readiness-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');const http=require('node:http');http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1');http.createServer((_request,response)=>(response.statusCode=fs.existsSync('delayed-ready')?200:503,response.end('status'))).listen(Number(process.env.DELAYED_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: {
                DELAYED_PORT: "{apps.Delayed.port}",
                WEB_PORT: "{apps.Web.port}",
              },
              apps: {
                Delayed: {
                  protocol: "http",
                  readiness: {
                    path: "/",
                    statuses: "200-399",
                    timeoutSeconds: 1,
                    type: "http",
                  },
                },
                Web: { protocol: "http" },
              },
            },
          },
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        routing: new InMemoryRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(
        controller.inspect(repository).worktrees[0]?.appGroups[0]?.health
      ).toBe("partially-running");

      writeFileSync(join(repository, "delayed-ready"), "yes");
      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      const recovered =
        controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(recovered?.health).toBe("running");
      expect(recovered?.apps.every((app) => app.routeState === "active")).toBe(
        true
      );
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("keeps an all-unready command runtime stoppable and retryable", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-unready-command-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Services: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');fs.writeFileSync('start-count',String(Number(fs.existsSync('start-count')?fs.readFileSync('start-count','utf8'):0)+1));require('node:http').createServer((_request,response)=>(response.statusCode=fs.existsSync('service-ready')?200:503,response.end('status'))).listen(Number(process.env.SERVICE_PORT),'127.0.0.1')",
                ],
              },
              stop: { argv: ["true"] },
              env: { SERVICE_PORT: "{apps.Service.port}" },
              apps: {
                Service: {
                  protocol: "http",
                  readiness: {
                    path: "/",
                    statuses: "200-399",
                    timeoutSeconds: 1,
                    type: "http",
                  },
                },
              },
            },
          },
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        routing: new InMemoryRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, worktreeId, "Services")
      ).rejects.toThrow();
      const unready = controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(unready?.health).toBe("partially-running");
      expect(unready?.apps[0]?.listening).toBe(true);
      expect(unready?.instances[0]?.running).toBe(true);
      expect(readFileSync(join(repository, "start-count"), "utf8")).toBe("1");

      writeFileSync(join(repository, "service-ready"), "yes");
      expect(
        await controller.startAppGroup(repository, worktreeId, "Services")
      ).toBe("started");
      expect(
        controller.inspect(repository).worktrees[0]?.appGroups[0]?.health
      ).toBe("running");
      expect(readFileSync(join(repository, "start-count"), "utf8")).toBe("1");
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Services")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("does not project an unrelated listener as a running command instance", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-ownership-"));
    const repository = join(temporary, "project");
    mkdirSync(repository);
    const listener = createServer();
    try {
      git(repository, "init", "-q");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Services: {
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      const state = new FileWorkgroveStateStore(join(temporary, "state.json"));
      const controller = new TrustedWorkspaceController(undefined, {
        routing: new InMemoryRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state,
      });
      const initial = controller.inspect(repository);
      const worktree = initial.worktrees[0];
      const group = worktree?.appGroups[0];
      expect(group).toBeDefined();
      await listen(listener, 0);
      const address = listener.address();
      if (!address || typeof address === "string") {
        throw new Error("Test listener did not expose a TCP port");
      }
      const key = {
        instanceId: group?.instance.id ?? "",
        repoPath: initial.repoPath,
      };
      state.assignEndpointPort(key, "Database", address.port);
      state.saveRun(key, {
        apps: {
          Database: {
            appId: "Database",
            host: "127.0.0.1",
            observedPids: [2_147_483_647],
            port: address.port,
            protocol: "tcp",
          },
        },
        createdAt: new Date().toISOString(),
        groupId: "Services",
        instanceId: key.instanceId,
        instanceIdsByGroup: { Services: key.instanceId },
        worktreePath: worktree?.path ?? repository,
      });

      const inspected =
        controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(inspected?.apps[0]?.listening).toBe(false);
      expect(inspected?.apps[0]?.ownership).toBe("foreign");
      expect(inspected?.apps[0]?.readiness).toBe("unready");
      expect(inspected?.health).toBe("not-running");
      expect(inspected?.instances[0]?.running).toBe(false);
    } finally {
      await close(listener).catch(() => undefined);
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("stops a shared instance with its captured Start environment", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "workgrove-shared-stop-"));
    const repository = join(temporary, "project");
    const featureWorktree = join(temporary, "project-feature");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let featureId = "";
    try {
      git(repository, "init", "-q");
      git(repository, "config", "user.email", "workgrove@example.test");
      git(repository, "config", "user.name", "Workgrove Test");
      writeFileSync(
        join(repository, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: { argv: ["true"] },
              stop: "process",
              apps: { Web: { protocol: "http" } },
            },
            Services: {
              instances: { mode: "selectable" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:net').createServer().listen(Number(process.env.DB_PORT),'127.0.0.1')",
                ],
              },
              stop: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:fs').writeFileSync('stopped-with-port.txt',process.env.PRODUCT_PORT)",
                ],
              },
              env: {
                DB_PORT: "{apps.Database.port}",
                PRODUCT_PORT: "{appGroups.Apps.apps.Web.port}",
              },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      git(repository, "add", ".workgrove.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      controller = new TrustedWorkspaceController(undefined, {
        routing: new InMemoryRoutingEngine(),
        processes: new ProcessSupervisor(join(temporary, "control")),
        state: new FileWorkgroveStateStore(join(temporary, "state.json")),
      });
      const initial = controller.inspect(repository);
      const main = initial.worktrees.find((worktree) => worktree.isMain);
      const feature = initial.worktrees.find((worktree) => !worktree.isMain);
      featureId = feature?.id ?? "";

      await controller.startAppGroup(repository, main?.id ?? "", "Services");
      const mainProductPort = controller
        .inspect(repository)
        .worktrees.find((worktree) => worktree.isMain)
        ?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      expect(mainProductPort).toBeNumber();

      await controller.stopAppGroup(repository, featureId, "Services");
      expect(
        readFileSync(join(repository, "stopped-with-port.txt"), "utf8")
      ).toBe(String(mainProductPort));
    } finally {
      if (controller && featureId) {
        await controller
          .stopAppGroup(repository, featureId, "Services")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 15_000);
});
