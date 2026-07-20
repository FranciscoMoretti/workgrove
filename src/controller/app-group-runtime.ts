import { basename } from "node:path";

import {
  type ResolvedWorkgroveAppGroups,
  resolveStartCommand,
  resolveStopCommand,
} from "../config/workgrove-config";
import type { WorkgroveApp, WorkgroveConfig } from "../config/workgrove-schema";
import type { LocalRoute, LocalRoutingEngine } from "../runtime/local-routing";
import type {
  EndpointAssignment,
  FileWorkgroveStateStore,
  RunEndpoint,
  RunKey,
} from "../runtime/local-state";
import {
  inspectListeningPorts,
  ownedPortPids,
  portOwnership,
} from "../runtime/ports";
import {
  appGroupProcessId,
  type ProcessSupervisor,
} from "../runtime/process-supervisor";
import {
  appIsReady,
  appIsReadySync,
  type BackingPortLease,
  reserveBackingPort,
  waitForAppReadiness,
} from "../runtime/readiness";
import type {
  AppEndpointSnapshot,
  AppGroupSnapshot,
  AppHealth,
} from "./workspace-snapshot";
import { commandWorkingDirectory } from "./worktree-command";

export interface AppGroupTarget {
  config: WorkgroveConfig;
  groupId: string;
  repoPath: string;
  worktree: {
    id: string;
    path: string;
    routeLabel: string;
  };
}

function displayName(id: string, value: { name?: string }): string {
  return value.name ?? id;
}

function groupHealth(apps: AppEndpointSnapshot[]): AppHealth {
  if (apps.length === 0 || apps.every((app) => app.readiness !== "ready")) {
    return "not-running";
  }
  return apps.every((app) => app.readiness === "ready")
    ? "running"
    : "partially-running";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AppGroupRuntime {
  private readonly processes: ProcessSupervisor;
  private readonly routing: LocalRoutingEngine;
  private readonly state: FileWorkgroveStateStore;

  constructor(
    processes: ProcessSupervisor,
    routing: LocalRoutingEngine,
    state: FileWorkgroveStateStore
  ) {
    this.processes = processes;
    this.routing = routing;
    this.state = state;
  }

  inspect(
    target: AppGroupTarget,
    ports: ReturnType<typeof inspectListeningPorts>
  ): AppGroupSnapshot {
    const group = this.group(target);
    const run = this.state.run(this.runKey(target));
    const processRunning =
      this.processes.managedPid(
        appGroupProcessId(target.worktree.id, target.groupId),
        target.worktree.path
      ) !== null;
    const apps = Object.entries(group.apps).map(([appId, app]) =>
      this.inspectEndpoint({
        app,
        appId,
        ports,
        run: run?.apps[appId] ?? null,
        stop: group.stop,
        target,
      })
    );
    return {
      apps,
      health: groupHealth(apps),
      id: target.groupId,
      name: displayName(target.groupId, group),
      processRunning,
      stop: group.stop === "process" ? "process" : "command",
    };
  }

  async start(target: AppGroupTarget): Promise<"already-running" | "started"> {
    const group = this.group(target);
    const key = this.runKey(target);
    let run = this.state.run(key);
    const allocatedNow = run === null;
    if (!run) {
      const apps: Record<string, RunEndpoint> = {};
      const leased = this.state.leasedPorts();
      const reservations: BackingPortLease[] = [];
      try {
        for (const [appId, app] of Object.entries(group.apps)) {
          const assignment = this.endpointAssignment(target, appId, app);
          const reservation = await reserveBackingPort(leased);
          reservations.push(reservation);
          leased.add(reservation.port);
          apps[appId] = {
            appId,
            ...(app.protocol === "http"
              ? {
                  directUrl: `http://127.0.0.1:${reservation.port}`,
                  hostname: assignment.hostname,
                  url: this.routing.url(assignment.hostname),
                }
              : {}),
            host: "127.0.0.1",
            port: reservation.port,
            protocol: app.protocol,
          };
        }
        run = {
          apps,
          createdAt: new Date().toISOString(),
          groupId: target.groupId,
        };
        this.state.saveRun(key, run);
      } finally {
        await Promise.all(
          reservations.map((reservation) => reservation.release())
        );
      }
    }

    const allReady = await Promise.all(
      Object.entries(group.apps).map(([appId, app]) =>
        appIsReady(app, run.apps[appId] as RunEndpoint)
      )
    );
    if (allocatedNow && allReady.some(Boolean)) {
      this.state.removeRun(key);
      throw new Error(
        "A newly allocated Backing endpoint became occupied before Start; retry Start"
      );
    }
    if (group.stop === "process") {
      const ports = inspectListeningPorts();
      const foreign = Object.values(run.apps).find(
        (endpoint) =>
          portOwnership(ports, endpoint.port, target.worktree.path) ===
          "foreign"
      );
      if (foreign) {
        throw new Error(
          `Backing endpoint ${foreign.port} is occupied by a process outside this worktree`
        );
      }
    }
    const allRoutesActive = Object.values(run.apps).every(
      (endpoint) =>
        endpoint.protocol !== "http" ||
        (endpoint.hostname &&
          this.routing.observe({
            hostname: endpoint.hostname,
            port: endpoint.port,
          }) === "active")
    );
    if (allReady.every(Boolean) && allRoutesActive) {
      return "already-running";
    }

    const processId = appGroupProcessId(target.worktree.id, target.groupId);
    let managedStart =
      this.processes.managedPid(processId, target.worktree.path) !== null;
    if (!(managedStart || allReady.some(Boolean))) {
      const command = resolveStartCommand(
        target.config,
        target.groupId,
        this.templateGroups(target, run)
      );
      this.processes.startManagedProcess({
        argv: command.argv,
        cwd: commandWorkingDirectory(target.worktree.path, command.cwd),
        env: command.env,
        logId: processId,
        label: displayName(target.groupId, group),
        ownerId: processId,
        ownerRoot: target.worktree.path,
        trackExitFailure: true,
        processId,
      });
      managedStart = true;
    }

    await Promise.all(
      Object.entries(group.apps).map(([appId, app]) =>
        waitForAppReadiness(app, run.apps[appId] as RunEndpoint)
      )
    );
    if (group.stop === "process") {
      const ports = inspectListeningPorts();
      const unowned = Object.values(run.apps).find(
        (endpoint) =>
          portOwnership(ports, endpoint.port, target.worktree.path) !== "owned"
      );
      if (unowned) {
        throw new Error(
          `Backing endpoint ${unowned.port} became ready outside this worktree; no Friendly URLs were published`
        );
      }
    }
    const managedStartHealth = {
      active: managedStart,
      label: displayName(target.groupId, group),
      processId,
      worktreePath: target.worktree.path,
    };
    this.assertManagedStartHealthy(managedStartHealth);
    await this.activateRoutesForManagedStart(run, managedStartHealth);
    return "started";
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route, command, process, and quarantine failures must be accumulated in lifecycle order.
  async stop(target: AppGroupTarget): Promise<"already-stopped" | "stopped"> {
    const group = this.group(target);
    const key = this.runKey(target);
    const run = this.state.run(key);
    const processId = appGroupProcessId(target.worktree.id, target.groupId);
    if (
      !run &&
      this.processes.managedPid(processId, target.worktree.path) === null
    ) {
      return "already-stopped";
    }

    const failures: string[] = [];
    for (const endpoint of Object.values(run?.apps ?? {})) {
      if (endpoint.protocol === "http" && endpoint.hostname) {
        try {
          const route = this.endpointRoute(endpoint);
          const routeState = this.routing.observe(route);
          if (routeState === "conflict" || routeState === "inactive") {
            continue;
          }
          await this.routing.deactivate(route);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (group.stop !== "process") {
      try {
        const command = resolveStopCommand(
          target.config,
          target.groupId,
          this.templateGroups(target, run)
        );
        if (!command) {
          throw new Error(
            `${displayName(target.groupId, group)} has no Stop command`
          );
        }
        await this.processes.runFiniteCommand({
          argv: command.argv,
          cwd: commandWorkingDirectory(target.worktree.path, command.cwd),
          env: command.env,
          label: `Stop ${displayName(target.groupId, group)}`,
          logId: processId,
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    await this.processes.stopManagedProcess(processId, target.worktree.path);
    if (group.stop === "process" && run) {
      const killed = new Set<number>();
      for (const pid of ownedPortPids(
        inspectListeningPorts(),
        Object.values(run.apps).map((app) => app.port),
        target.worktree.path
      )) {
        if (await this.processes.stopOwnedProcess(pid, processId)) {
          killed.add(pid);
        }
      }
      if (killed.size > 0) {
        this.processes.appendManagedLog(
          processId,
          `[workgrove] Stopped ${killed.size} owned listener${killed.size === 1 ? "" : "s"}`
        );
      }
    }

    if (run && !(await this.waitForPortsStopped(run))) {
      failures.push(
        "App listeners did not stop; Backing endpoints remain quarantined"
      );
    }
    if (failures.length === 0) {
      this.state.removeRun(key);
    }
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
    return "stopped";
  }

  private group(target: AppGroupTarget) {
    const group = target.config.appGroups[target.groupId];
    if (!group) {
      throw new Error(`Unknown App group "${target.groupId}"`);
    }
    return group;
  }

  private runKey(target: AppGroupTarget): RunKey {
    return {
      groupId: target.groupId,
      repoPath: target.repoPath,
      worktreePath: target.worktree.path,
    };
  }

  private endpointAssignment(
    target: AppGroupTarget,
    appId: string,
    app: WorkgroveApp,
    groupId = target.groupId
  ): EndpointAssignment {
    return this.state.endpoint({
      appId,
      appLabel: displayName(appId, app),
      groupId,
      repoLabel: basename(target.repoPath),
      repoPath: target.repoPath,
      worktreeLabel: target.worktree.routeLabel,
      worktreePath: target.worktree.path,
    });
  }

  private inspectEndpoint(input: {
    app: WorkgroveApp;
    appId: string;
    ports: ReturnType<typeof inspectListeningPorts>;
    run: RunEndpoint | null;
    stop: WorkgroveConfig["appGroups"][string]["stop"];
    target: AppGroupTarget;
  }): AppEndpointSnapshot {
    this.endpointAssignment(input.target, input.appId, input.app);
    if (!input.run) {
      return {
        directUrl: null,
        id: input.appId,
        label: displayName(input.appId, input.app),
        listening: false,
        open: false,
        ownership: "none",
        port: null,
        protocol: input.app.protocol,
        readiness: "waiting",
        routeState: "inactive",
        url: null,
      };
    }
    const ownership = portOwnership(
      input.ports,
      input.run.port,
      input.target.worktree.path
    );
    const listening =
      input.stop === "process" ? ownership === "owned" : ownership !== "none";
    const ready = appIsReadySync(input.app, input.run, listening);
    const routeState =
      input.run.protocol === "http" && input.run.hostname
        ? this.routing.observe({
            hostname: input.run.hostname,
            port: input.run.port,
          })
        : "inactive";
    return {
      directUrl: input.run.directUrl ?? null,
      id: input.appId,
      label: displayName(input.appId, input.app),
      listening,
      open: ready && routeState === "active",
      ownership,
      port: input.run.port,
      protocol: input.app.protocol,
      readiness: ready ? "ready" : "unready",
      routeState,
      url: ready && routeState === "active" ? (input.run.url ?? null) : null,
    };
  }

  private templateGroups(
    target: AppGroupTarget,
    currentRun: { apps: Record<string, RunEndpoint>; groupId: string } | null
  ): ResolvedWorkgroveAppGroups {
    return Object.fromEntries(
      Object.entries(target.config.appGroups).map(([groupId, group]) => [
        groupId,
        {
          apps: Object.fromEntries(
            Object.entries(group.apps).map(([appId, app]) => {
              const assignment = this.endpointAssignment(
                target,
                appId,
                app,
                groupId
              );
              const running =
                currentRun?.groupId === groupId
                  ? currentRun.apps[appId]
                  : undefined;
              return [
                appId,
                running ??
                  (app.protocol === "http"
                    ? { url: this.routing.url(assignment.hostname) }
                    : {}),
              ];
            })
          ),
          id: groupId,
        },
      ])
    );
  }

  private assertManagedStartHealthy(input: {
    active: boolean;
    label: string;
    processId: string;
    worktreePath: string;
  }): void {
    if (
      !input.active ||
      this.processes.managedPid(input.processId, input.worktreePath) !== null
    ) {
      return;
    }
    const failure = this.processes.managedFailure(input.processId);
    if (failure) {
      throw new Error(
        `${input.label} exited before Friendly URLs were activated: ${failure.message}`
      );
    }
  }

  private async waitForPortsStopped(run: {
    apps: Record<string, RunEndpoint>;
  }): Promise<boolean> {
    const deadline = Date.now() + 5000;
    const ports = new Set(Object.values(run.apps).map((app) => app.port));
    while (Date.now() < deadline) {
      const snapshot = inspectListeningPorts();
      if (
        [...ports].every(
          (port) => portOwnership(snapshot, port, "/") === "none"
        )
      ) {
        return true;
      }
      await delay(100);
    }
    return false;
  }

  private async activateRoutes(run: {
    apps: Record<string, RunEndpoint>;
  }): Promise<void> {
    const routes = Object.values(run.apps).flatMap((endpoint) =>
      endpoint.protocol === "http" && endpoint.hostname
        ? [this.endpointRoute(endpoint)]
        : []
    );
    try {
      for (const route of routes) {
        if (this.routing.observe(route) === "conflict") {
          throw new Error(`${route.hostname} is already routed elsewhere`);
        }
      }
      for (const route of routes) {
        await this.routing.activate(route);
      }
    } catch (error) {
      const failures = [error instanceof Error ? error.message : String(error)];
      for (const route of routes.toReversed()) {
        try {
          const routeState = this.routing.observe(route);
          if (routeState !== "active" && routeState !== "unavailable") {
            continue;
          }
          await this.routing.deactivate(route);
        } catch (rollbackError) {
          failures.push(
            `Route rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      }
      throw new Error(failures.join("; "));
    }
  }

  private async activateRoutesForManagedStart(
    run: { apps: Record<string, RunEndpoint> },
    managedStart: {
      active: boolean;
      label: string;
      processId: string;
      worktreePath: string;
    }
  ): Promise<void> {
    try {
      await this.activateRoutes(run);
    } catch (error) {
      this.assertManagedStartHealthy(managedStart);
      throw error;
    }
  }

  private endpointRoute(endpoint: RunEndpoint): LocalRoute {
    if (!endpoint.hostname) {
      throw new Error(`${endpoint.appId} does not have a Friendly hostname`);
    }
    return { hostname: endpoint.hostname, port: endpoint.port };
  }
}
