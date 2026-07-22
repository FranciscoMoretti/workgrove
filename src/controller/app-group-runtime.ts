import { basename } from "node:path";

import {
  type ResolvedWorkgroveAppGroups,
  resolveStartCommand,
  resolveStopCommand,
} from "../config/workgrove-config";
import type {
  WorkgroveApp,
  WorkgroveAppGroup,
  WorkgroveConfig,
} from "../config/workgrove-schema";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../runtime/local-routing";
import type {
  AppGroupInstance,
  AppGroupRun,
  EndpointAssignment,
  FileWorkgroveStateStore,
  InstanceRequest,
  RunEndpoint,
  RunKey,
} from "../runtime/local-state";
import {
  inspectListeningPorts,
  listeningPortPids,
  ownedPortPids,
  portOwnership,
} from "../runtime/ports";
import {
  appGroupInstanceProcessId,
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
  if (apps.length === 0 || apps.every((app) => !app.listening)) {
    return "not-running";
  }
  return apps.every((app) => app.readiness === "ready")
    ? "running"
    : "partially-running";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function samePids(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((pid, index) => pid === right[index])
  );
}

function endpointMatchesObservedPids(
  endpoint: RunEndpoint,
  ports: ReturnType<typeof inspectListeningPorts>
): boolean {
  const current = listeningPortPids(ports, endpoint.port);
  return current.length > 0 && samePids(endpoint.observedPids ?? [], current);
}

export class AppGroupRuntime {
  private readonly lifecycleOperations = new Map<string, Promise<void>>();
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
    const instance = this.state.instance(this.instanceRequest(target));
    const run = this.state.run(this.runKey(target.repoPath, instance.id));
    const processPath = run?.worktreePath ?? target.worktree.path;
    const processRunning =
      this.processes.managedPid(
        appGroupInstanceProcessId(instance.id),
        processPath
      ) !== null;
    const apps = Object.entries(group.apps).map(([appId, app]) => {
      const assignment = this.endpointAssignment({
        app,
        appId,
        groupId: target.groupId,
        instance,
        repoPath: target.repoPath,
      });
      return this.inspectEndpoint({
        app,
        appId,
        assignment,
        ports,
        run: run?.apps[appId] ?? null,
        stop: group.stop,
        worktreePath: processPath,
      });
    });
    return {
      apps,
      health: groupHealth(apps),
      id: target.groupId,
      instance: {
        id: instance.id,
        mode: instance.mode,
        name: instance.name,
      },
      instances:
        instance.mode === "selectable"
          ? this.state
              .instances(target.repoPath, target.groupId)
              .map((option) => ({
                id: option.id,
                name: option.name,
                running: this.instanceIsRunning(option, group.stop, ports),
              }))
          : [
              {
                id: instance.id,
                name: instance.name,
                running: this.instanceIsRunning(instance, group.stop, ports),
              },
            ],
      name: displayName(target.groupId, group),
      processRunning,
      stop: group.stop === "process" ? "process" : "command",
    };
  }

  start(target: AppGroupTarget): Promise<"already-running" | "started"> {
    const effectiveInstances = this.worktreeInstances(target);
    return this.serializeLifecycle(
      Object.values(effectiveInstances).map((instance) =>
        this.lifecycleKey(target.repoPath, instance.id)
      ),
      () => this.startUnlocked(target, effectiveInstances)
    );
  }

  private async startUnlocked(
    target: AppGroupTarget,
    effectiveInstances: Record<string, AppGroupInstance>
  ): Promise<"already-running" | "started"> {
    const group = this.group(target);
    await this.routing.prepare?.();
    await this.materializeWorktreeInstances(target, effectiveInstances);
    const instance = effectiveInstances[target.groupId];
    if (!instance) {
      throw new Error(`Unknown App group "${target.groupId}"`);
    }
    const key = this.runKey(target.repoPath, instance.id);
    let run = this.state.run(key);
    const allocatedNow = run === null;
    if (!run) {
      run = this.createRun({
        effectiveInstances,
        group,
        groupId: target.groupId,
        instance,
        repoPath: target.repoPath,
        worktreePath: target.worktree.path,
      });
      this.state.saveRun(key, run);
    }

    this.assertRunPortsAvailable(run, group, key, allocatedNow);
    const readiness = await Promise.all(
      Object.entries(group.apps).map(([appId, app]) =>
        appIsReady(app, run.apps[appId] as RunEndpoint)
      )
    );
    if (readiness.every(Boolean) && this.allRoutesAreActive(run)) {
      return "already-running";
    }

    const processId = appGroupInstanceProcessId(instance.id);
    this.launchRunProcess({
      readiness,
      group,
      processId,
      run,
      target,
    });
    const readyAppIds = await this.waitForRunReadiness(
      group,
      run,
      processId,
      key
    );
    this.assertReadyEndpointsOwned(group, run, readyAppIds);
    await this.publishReadyRun(key, run, readyAppIds);
    return "started";
  }

  stop(target: AppGroupTarget): Promise<"already-stopped" | "stopped"> {
    const instance = this.state.instance(this.instanceRequest(target));
    return this.serializeLifecycle(
      [this.lifecycleKey(target.repoPath, instance.id)],
      () => this.stopUnlocked(target, instance)
    );
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route, command, process, and quarantine failures must be accumulated in lifecycle order.
  private async stopUnlocked(
    target: AppGroupTarget,
    instance: AppGroupInstance
  ): Promise<"already-stopped" | "stopped"> {
    const group = this.group(target);
    const key = this.runKey(target.repoPath, instance.id);
    const run = this.state.run(key);
    const processPath = run?.worktreePath ?? target.worktree.path;
    const processId = appGroupInstanceProcessId(instance.id);
    if (!run && this.processes.managedPid(processId, processPath) === null) {
      return "already-stopped";
    }

    const failures: string[] = [];
    for (const endpoint of Object.values(run?.apps ?? {})) {
      if (endpoint.protocol !== "http" || !endpoint.hostname) {
        continue;
      }
      try {
        const route = this.endpointRoute(endpoint);
        const routeState = this.routing.observe(route);
        if (routeState === "conflict") {
          failures.push(
            `${route.hostname} points to a different Backing endpoint`
          );
          continue;
        }
        if (routeState !== "inactive") {
          await this.routing.deactivate(route);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (group.stop !== "process") {
      try {
        const command = resolveStopCommand(
          target.config,
          target.groupId,
          this.templateGroups(
            target.config,
            target.repoPath,
            processPath,
            run?.instanceIdsByGroup
          )
        );
        if (!command) {
          throw new Error(
            `${displayName(target.groupId, group)} has no Stop command`
          );
        }
        await this.processes.runFiniteCommand({
          argv: command.argv,
          cwd: commandWorkingDirectory(processPath, command.cwd),
          env: command.env,
          label: `Stop ${displayName(target.groupId, group)}`,
          logId: processId,
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    await this.processes.stopManagedProcess(processId, processPath);
    if (group.stop === "process" && run) {
      const killed = new Set<number>();
      for (const pid of ownedPortPids(
        inspectListeningPorts(),
        Object.values(run.apps).map((app) => app.port),
        processPath
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

  createInstance(target: AppGroupTarget, name: string): AppGroupInstance {
    return this.state.createSelectableInstance(
      this.instanceRequest(target),
      name
    );
  }

  selectInstance(target: AppGroupTarget, instanceId: string): AppGroupInstance {
    return this.state.selectInstance(this.instanceRequest(target), instanceId);
  }

  logId(target: AppGroupTarget): string {
    const instance = this.state.instance(this.instanceRequest(target));
    return appGroupInstanceProcessId(instance.id);
  }

  private group(target: AppGroupTarget): WorkgroveAppGroup {
    const group = target.config.appGroups[target.groupId];
    if (!group) {
      throw new Error(`Unknown App group "${target.groupId}"`);
    }
    return group;
  }

  private instanceRequest(target: AppGroupTarget): InstanceRequest {
    const group = this.group(target);
    return {
      groupId: target.groupId,
      mode: group.instances.mode,
      repoLabel: basename(target.repoPath),
      repoPath: target.repoPath,
      worktreeLabel: target.worktree.routeLabel,
      worktreePath: target.worktree.path,
    };
  }

  private async serializeLifecycle<T>(
    keys: readonly string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const operationKeys = [...new Set(keys)].toSorted();
    const predecessor = Promise.all(
      operationKeys.map((key) =>
        (this.lifecycleOperations.get(key) ?? Promise.resolve()).catch(
          () => undefined
        )
      )
    ).then(() => undefined);
    let release: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => completion);
    for (const key of operationKeys) {
      this.lifecycleOperations.set(key, tail);
    }
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      for (const key of operationKeys) {
        if (this.lifecycleOperations.get(key) === tail) {
          this.lifecycleOperations.delete(key);
        }
      }
    }
  }

  private lifecycleKey(repoPath: string, instanceId: string): string {
    return [repoPath, instanceId].join("\0");
  }

  private worktreeInstances(
    target: AppGroupTarget
  ): Record<string, AppGroupInstance> {
    return Object.fromEntries(
      Object.entries(target.config.appGroups).map(([groupId, group]) => [
        groupId,
        this.state.instance({
          groupId,
          mode: group.instances.mode,
          repoLabel: basename(target.repoPath),
          repoPath: target.repoPath,
          worktreeLabel: target.worktree.routeLabel,
          worktreePath: target.worktree.path,
        }),
      ])
    );
  }

  private runKey(repoPath: string, instanceId: string): RunKey {
    return { instanceId, repoPath };
  }

  private instanceIsRunning(
    instance: AppGroupInstance,
    stop: WorkgroveAppGroup["stop"],
    ports: ReturnType<typeof inspectListeningPorts>
  ): boolean {
    const run = instance.run;
    if (!run) {
      return false;
    }
    if (
      this.processes.managedPid(
        appGroupInstanceProcessId(instance.id),
        run.worktreePath
      ) !== null
    ) {
      return true;
    }
    return Object.values(run.apps).some((endpoint) => {
      const ownership = portOwnership(ports, endpoint.port, run.worktreePath);
      return stop === "process"
        ? ownership === "owned"
        : endpointMatchesObservedPids(endpoint, ports);
    });
  }

  private createRun(input: {
    effectiveInstances: Record<string, AppGroupInstance>;
    group: WorkgroveAppGroup;
    groupId: string;
    instance: AppGroupInstance;
    repoPath: string;
    worktreePath: string;
  }): AppGroupRun {
    const apps = Object.fromEntries(
      Object.entries(input.group.apps).map(([appId, app]) => {
        const assignment = this.endpointAssignment({
          app,
          appId,
          groupId: input.groupId,
          instance: input.instance,
          repoPath: input.repoPath,
        });
        return [appId, this.runEndpoint(app, assignment)];
      })
    );
    return {
      apps,
      createdAt: new Date().toISOString(),
      groupId: input.groupId,
      instanceId: input.instance.id,
      instanceIdsByGroup: Object.fromEntries(
        Object.entries(input.effectiveInstances).map(([groupId, instance]) => [
          groupId,
          instance.id,
        ])
      ),
      worktreePath: input.worktreePath,
    };
  }

  private assertRunPortsAvailable(
    run: AppGroupRun,
    group: WorkgroveAppGroup,
    key: RunKey,
    allocatedNow: boolean
  ): void {
    const ports = inspectListeningPorts();
    const occupied = Object.values(run.apps).find((endpoint) => {
      const pids = listeningPortPids(ports, endpoint.port);
      if (pids.length === 0) {
        return false;
      }
      if (allocatedNow) {
        return true;
      }
      if (group.stop === "process") {
        return (
          portOwnership(ports, endpoint.port, run.worktreePath) !== "owned"
        );
      }
      return !samePids(endpoint.observedPids ?? [], pids);
    });
    if (!occupied) {
      return;
    }
    if (allocatedNow) {
      this.state.removeRun(key);
    }
    throw new Error(
      `Backing endpoint ${occupied.port} is occupied by an unrelated process`
    );
  }

  private allRoutesAreActive(run: AppGroupRun): boolean {
    return Object.values(run.apps).every(
      (endpoint) =>
        endpoint.protocol !== "http" ||
        (endpoint.hostname &&
          this.routing.observe(this.endpointRoute(endpoint)) === "active")
    );
  }

  private launchRunProcess(input: {
    readiness: readonly boolean[];
    group: WorkgroveAppGroup;
    processId: string;
    run: AppGroupRun;
    target: AppGroupTarget;
  }): void {
    if (
      this.processes.managedPid(input.processId, input.run.worktreePath) !==
        null ||
      input.readiness.some(Boolean)
    ) {
      return;
    }
    const command = resolveStartCommand(
      input.target.config,
      input.target.groupId,
      this.templateGroups(
        input.target.config,
        input.target.repoPath,
        input.run.worktreePath,
        input.run.instanceIdsByGroup
      )
    );
    this.processes.startManagedProcess({
      argv: command.argv,
      cwd: commandWorkingDirectory(input.run.worktreePath, command.cwd),
      env: command.env,
      label: displayName(input.target.groupId, input.group),
      logId: input.processId,
      ownerId: input.processId,
      ownerRoot: input.run.worktreePath,
      trackExitFailure: true,
      processId: input.processId,
    });
  }

  private async waitForRunReadiness(
    group: WorkgroveAppGroup,
    run: AppGroupRun,
    processId: string,
    key: RunKey
  ): Promise<Set<string>> {
    const settled = await Promise.allSettled(
      Object.entries(group.apps).map(async ([appId, app]) => {
        await waitForAppReadiness(app, run.apps[appId] as RunEndpoint);
        return appId;
      })
    );
    const readyAppIds = new Set(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
    );
    const failures = settled.flatMap((result) =>
      result.status === "rejected"
        ? [
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          ]
        : []
    );
    if (readyAppIds.size === 0) {
      this.observeRunListeners(run);
      this.state.saveRun(key, run);
      throw new Error(failures.join("; "));
    }
    for (const failure of failures) {
      this.processes.appendManagedLog(processId, `[workgrove] ${failure}`);
    }
    return readyAppIds;
  }

  private assertReadyEndpointsOwned(
    group: WorkgroveAppGroup,
    run: AppGroupRun,
    readyAppIds: ReadonlySet<string>
  ): void {
    if (group.stop !== "process") {
      return;
    }
    const ports = inspectListeningPorts();
    const unowned = Object.values(run.apps).find(
      (endpoint) =>
        readyAppIds.has(endpoint.appId) &&
        portOwnership(ports, endpoint.port, run.worktreePath) !== "owned"
    );
    if (unowned) {
      throw new Error(
        `Backing endpoint ${unowned.port} became ready outside this worktree; no Friendly URLs were published`
      );
    }
  }

  private async publishReadyRun(
    key: RunKey,
    run: AppGroupRun,
    readyAppIds: ReadonlySet<string>
  ): Promise<void> {
    this.observeRunListeners(run);
    try {
      await this.activateRoutes(run, readyAppIds);
    } catch (error) {
      this.state.saveRun(key, run);
      throw error;
    }
    this.state.saveRun(key, run);
  }

  private observeRunListeners(run: AppGroupRun): void {
    const ports = inspectListeningPorts();
    for (const endpoint of Object.values(run.apps)) {
      const observedPids = listeningPortPids(ports, endpoint.port);
      if (observedPids.length > 0) {
        endpoint.observedPids = observedPids;
      }
    }
  }

  private endpointAssignment(input: {
    app: WorkgroveApp;
    appId: string;
    groupId: string;
    instance: AppGroupInstance;
    repoPath: string;
  }): EndpointAssignment {
    return this.state.endpoint({
      appId: input.appId,
      appLabel: displayName(input.appId, input.app),
      groupId: input.groupId,
      instanceId: input.instance.id,
      repoPath: input.repoPath,
    });
  }

  private inspectEndpoint(input: {
    app: WorkgroveApp;
    appId: string;
    assignment: EndpointAssignment;
    ports: ReturnType<typeof inspectListeningPorts>;
    run: RunEndpoint | null;
    stop: WorkgroveAppGroup["stop"];
    worktreePath: string;
  }): AppEndpointSnapshot {
    if (!input.run) {
      return {
        directUrl: null,
        id: input.appId,
        label: displayName(input.appId, input.app),
        listening: false,
        open: false,
        ownership: "none",
        port: input.assignment.port,
        protocol: input.app.protocol,
        readiness: "waiting",
        routeState: "inactive",
        url: null,
      };
    }
    const inspectedOwnership = portOwnership(
      input.ports,
      input.run.port,
      input.worktreePath
    );
    const commandEndpointVerified = endpointMatchesObservedPids(
      input.run,
      input.ports
    );
    const listening =
      input.stop === "process"
        ? inspectedOwnership === "owned"
        : commandEndpointVerified;
    let ownership = inspectedOwnership;
    if (input.stop !== "process") {
      if (commandEndpointVerified) {
        ownership = "owned";
      } else if (inspectedOwnership !== "none") {
        ownership = "foreign";
      }
    }
    const ready = appIsReadySync(input.app, input.run, listening);
    const observedRouteState =
      input.run.protocol === "http" && input.run.hostname
        ? this.routing.observe({
            hostname: input.run.hostname,
            port: input.run.port,
          })
        : "inactive";
    const routeState =
      observedRouteState === "inactive" &&
      ready &&
      input.run.protocol === "http"
        ? "unavailable"
        : observedRouteState;
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
    config: WorkgroveConfig,
    repoPath: string,
    worktreePath: string,
    instanceIdsByGroup?: Record<string, string>
  ): ResolvedWorkgroveAppGroups {
    return Object.fromEntries(
      Object.entries(config.appGroups).map(([groupId, group]) => [
        groupId,
        {
          apps: Object.fromEntries(
            Object.entries(group.apps).map(([appId, app]) => {
              const selectedInstanceId = instanceIdsByGroup?.[groupId];
              const instance = selectedInstanceId
                ? this.state.instanceById(repoPath, selectedInstanceId)
                : this.state.instance({
                    groupId,
                    mode: group.instances.mode,
                    repoLabel: basename(repoPath),
                    repoPath,
                    worktreeLabel: basename(worktreePath),
                    worktreePath,
                  });
              if (!(instance && instance.groupId === groupId)) {
                throw new Error(`Unknown App-group instance for "${groupId}"`);
              }
              const assignment = this.endpointAssignment({
                app,
                appId,
                groupId,
                instance,
                repoPath,
              });
              if (assignment.port !== null) {
                return [appId, this.runEndpoint(app, assignment)];
              }
              return [
                appId,
                app.protocol === "http"
                  ? { url: this.routing.url(assignment.hostname) }
                  : {},
              ];
            })
          ),
          id: groupId,
        },
      ])
    );
  }

  private async materializeWorktreeInstances(
    target: AppGroupTarget,
    instances: Readonly<Record<string, AppGroupInstance>>
  ): Promise<void> {
    const leased = this.state.leasedPorts();
    const reservations: BackingPortLease[] = [];
    try {
      for (const [groupId, group] of Object.entries(target.config.appGroups)) {
        const instance = instances[groupId];
        if (!instance) {
          throw new Error(`Unknown App group "${groupId}"`);
        }
        const key = this.runKey(target.repoPath, instance.id);
        for (const [appId, app] of Object.entries(group.apps)) {
          const assignment = this.endpointAssignment({
            app,
            appId,
            groupId,
            instance,
            repoPath: target.repoPath,
          });
          if (assignment.port !== null) {
            continue;
          }
          const reservation = await reserveBackingPort(leased);
          reservations.push(reservation);
          leased.add(reservation.port);
          this.state.assignEndpointPort(key, appId, reservation.port);
        }
      }
    } finally {
      await Promise.all(
        reservations.map((reservation) => reservation.release())
      );
    }
  }

  private runEndpoint(
    app: WorkgroveApp,
    assignment: EndpointAssignment
  ): RunEndpoint {
    if (assignment.port === null) {
      throw new Error(`${assignment.appId} has no assigned port`);
    }
    return {
      appId: assignment.appId,
      ...(app.protocol === "http"
        ? {
            directUrl: `http://127.0.0.1:${assignment.port}`,
            hostname: assignment.hostname,
            url: this.routing.url(assignment.hostname),
          }
        : {}),
      host: "127.0.0.1",
      port: assignment.port,
      protocol: app.protocol,
    };
  }

  private async waitForPortsStopped(run: AppGroupRun): Promise<boolean> {
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

  private async activateRoutes(
    run: AppGroupRun,
    readyAppIds: ReadonlySet<string>
  ): Promise<void> {
    const routes = Object.values(run.apps).flatMap((endpoint) =>
      readyAppIds.has(endpoint.appId) &&
      endpoint.protocol === "http" &&
      endpoint.hostname
        ? [this.endpointRoute(endpoint)]
        : []
    );
    const newlyActivated: LocalRoute[] = [];
    try {
      const initialStates = new Map<LocalRoute, LocalRouteState>();
      for (const route of routes) {
        const state = this.routing.observe(route);
        initialStates.set(route, state);
        if (state === "conflict") {
          throw new Error(`${route.hostname} is already routed elsewhere`);
        }
      }
      for (const route of routes) {
        if (initialStates.get(route) === "inactive") {
          newlyActivated.push(route);
        }
        await this.routing.activate(route);
      }
    } catch (error) {
      const failures = [
        error instanceof Error ? error.message : String(error),
        ...(await this.rollbackRoutes(newlyActivated)),
      ];
      throw new Error(failures.join("; "));
    }
  }

  private async rollbackRoutes(
    routes: readonly LocalRoute[]
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const route of routes.toReversed()) {
      try {
        const routeState = this.routing.observe(route);
        if (routeState !== "active" && routeState !== "unavailable") {
          continue;
        }
        await this.routing.deactivate(route);
      } catch (error) {
        failures.push(
          `Route rollback failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return failures;
  }
  private endpointRoute(endpoint: RunEndpoint): LocalRoute {
    if (!endpoint.hostname) {
      throw new Error(`${endpoint.appId} does not have a Friendly hostname`);
    }
    return { hostname: endpoint.hostname, port: endpoint.port };
  }
}
