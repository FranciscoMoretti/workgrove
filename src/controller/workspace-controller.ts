import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CodexHookActivityStore,
  type CodexHookObservation,
} from "../codex/codex-hook-activity";
import {
  type CodexIntegrationAdapter,
  type CodexIntegrationLoadOptions,
  type CodexIntegrationSnapshot,
  projectCodexIntegration,
} from "../codex/codex-integration";
import { CodexTaskDiscoveryAdapter } from "../codex/codex-task-discovery";
import { CodexContextStore } from "../codex/workgrove-context";
import { clearLogs } from "../commands/clear-logs";
import { createWorktree } from "../commands/create-worktree";
import { deleteWorktree } from "../commands/delete-worktree";
import { initializeRepository } from "../commands/initialize-repository";
import { pickRepository } from "../commands/pick-repository";
import { previewRepositoryConfig } from "../commands/preview-repository-config";
import { restartApps } from "../commands/restart-apps";
import { restartRunningApps } from "../commands/restart-running-apps";
import { setupAllApps } from "../commands/setup-all-apps";
import { startAllApps } from "../commands/start-all-apps";
import { startApps } from "../commands/start-apps";
import { stopAllApps } from "../commands/stop-all-apps";
import { stopApps } from "../commands/stop-apps";
import { trustRepository } from "../commands/trust-repository";
import { updateRepositoryConfig } from "../commands/update-repository-config";
import {
  repositoryIsTrusted,
  repositoryRequiresTrust,
} from "../config/repository-trust";
import type { WorkgroveCommand } from "../config/workgrove-command";
import {
  findWorkgroveConfig,
  loadWorkgroveConfig,
  loadWorkgroveConfigDocument,
  type ResolvedWorkgroveAppGroups,
  resolveStartCommand,
  resolveStopCommand,
  updateWorkgroveConfig,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import type { WorkgroveApp, WorkgroveConfig } from "../config/workgrove-schema";
import { parseWorktreeList } from "../git/discover-worktrees";
import {
  type LocalRoute,
  type LocalRoutingEngine,
  PortlessRoutingEngine,
} from "../runtime/local-routing";
import {
  type EndpointAssignment,
  FileWorkgroveStateStore,
  type RunEndpoint,
  type RunKey,
} from "../runtime/local-state";
import {
  inspectListeningPorts,
  ownedPortPids,
  pathInside,
  portOwnership,
} from "../runtime/ports";
import {
  appendManagedLog,
  appGroupProcessId,
  listManagedProcesses,
  managedFailure,
  managedPid,
  readManagedLog,
  runFiniteCommand,
  setupProcessId,
  startManagedProcess,
  stopManagedProcess,
  stopOwnedProcess,
} from "../runtime/process-supervisor";
import {
  appIsReady,
  appIsReadySync,
  type BackingPortLease,
  reserveBackingPort,
  waitForAppReadiness,
} from "../runtime/readiness";
import {
  parseCommandInput,
  parseCommandResult,
  type WorkgroveCommandInput,
  type WorkgroveCommandName,
  type WorkgroveCommandResult,
} from "./command-contract";
import type {
  AppEndpointSnapshot,
  AppHealth,
  WorkspaceSnapshot,
} from "./workspace-snapshot";

type CommandHandler = (
  controller: WorkspaceController,
  input: Record<string, unknown>
) => unknown;

const COMMAND_HANDLERS: Record<WorkgroveCommandName, CommandHandler> = {
  "clear-logs": clearLogs,
  "create-worktree": createWorktree,
  "delete-worktree": deleteWorktree,
  "initialize-repository": initializeRepository,
  "pick-repository": pickRepository,
  "preview-repository-config": previewRepositoryConfig,
  "restart-apps": restartApps,
  "restart-running-apps": restartRunningApps,
  "setup-all-apps": setupAllApps,
  "start-all-apps": startAllApps,
  "start-apps": startApps,
  "stop-all-apps": stopAllApps,
  "stop-apps": stopApps,
  "trust-repository": trustRepository,
  "update-repository-config": updateRepositoryConfig,
};

export class MissingWorktreeConfigError extends Error {
  readonly code = "missing_worktree_config";
  readonly configPath: string;

  constructor(configPath: string) {
    super(`Missing worktree environment config: ${configPath}`);
    this.configPath = configPath;
    this.name = "MissingWorktreeConfigError";
  }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "Git command failed").trim()
    );
  }
  return result.stdout.trim();
}

function worktreeId(path: string): string {
  return Buffer.from(realpathSync(path)).toString("base64url");
}

function commandSummary(label: string, command: WorkgroveCommand): string {
  return `${label}: ${command.argv.join(" ")}`;
}

function worktreeSetupState(
  id: string,
  path: string
): "failed" | "idle" | "running" {
  const processId = setupProcessId(id);
  if (managedPid(processId, path) !== null) {
    return "running";
  }
  return managedFailure(processId) ? "failed" : "idle";
}

function primaryAppGroup(config: WorkgroveConfig): string {
  const entries = Object.entries(config.appGroups);
  return (
    entries.find(([, group]) => group.stop === "process")?.[0] ?? entries[0][0]
  );
}

function groupHealth(apps: AppEndpointSnapshot[]): AppHealth {
  if (apps.length === 0 || apps.every((app) => app.readiness !== "ready")) {
    return "not-running";
  }
  return apps.every((app) => app.readiness === "ready")
    ? "running"
    : "partially-running";
}

function displayName(id: string, value: { name?: string }): string {
  return value.name ?? id;
}

function worktreeRouteLabel(
  item: { branch: string | null },
  path: string
): string {
  return item.branch ?? basename(path);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds)
  );
}

export interface WorkspaceControllerRuntimeOptions {
  codexContext?: CodexContextStore;
  codexHooks?: CodexHookActivityStore;
  routing?: LocalRoutingEngine;
  state?: FileWorkgroveStateStore;
}

export interface CodexHookResult {
  accepted: boolean;
  additionalContext?: string;
}

export class WorkspaceController {
  private readonly codexAdapter: CodexIntegrationAdapter;
  private readonly codexActivity: CodexHookActivityStore;
  private readonly codexContext: CodexContextStore;
  private readonly codexRefreshes = new Map<string, Promise<void>>();
  private readonly knownCodexTasksByPath = new Map<string, Set<string>>();
  private readonly pendingCodexObservations = new Map<
    string,
    Map<string, { cwd: string; sessionId: string }>
  >();
  private readonly routing: LocalRoutingEngine;
  private readonly state: FileWorkgroveStateStore;

  constructor(
    codexAdapter: CodexIntegrationAdapter = new CodexTaskDiscoveryAdapter(),
    runtime: WorkspaceControllerRuntimeOptions = {}
  ) {
    this.codexAdapter = codexAdapter;
    this.codexActivity = runtime.codexHooks ?? new CodexHookActivityStore();
    this.codexContext = runtime.codexContext ?? new CodexContextStore();
    this.routing = runtime.routing ?? new PortlessRoutingEngine();
    this.state = runtime.state ?? new FileWorkgroveStateStore();
  }

  close(): Promise<void> {
    return this.codexAdapter.close();
  }

  async inspectCodex(
    repoPath: string,
    options?: CodexIntegrationLoadOptions
  ): Promise<CodexIntegrationSnapshot> {
    const workspace = this.inspect(repoPath);
    const worktrees = workspace.worktrees.map(({ id, path }) => ({ id, path }));
    const discovered = await this.codexAdapter.loadAssociatedTasks(
      worktrees,
      options
    );
    for (const { path } of worktrees) {
      this.knownCodexTasksByPath.set(path, new Set());
    }
    for (const { task, worktreePath } of discovered.tasks) {
      this.knownCodexTasksByPath.get(worktreePath)?.add(task.id);
    }
    const activitySnapshot = this.codexActivity.applyToSnapshot(
      discovered,
      new Date(),
      (worktreePath) => this.codexEnabledWorktree(worktreePath)
    );
    const adapterSnapshot = this.codexContext.applyToSnapshot(activitySnapshot);
    return projectCodexIntegration(worktrees, adapterSnapshot);
  }

  observeCodexHook(observation: CodexHookObservation): boolean {
    return this.acceptCodexHook(observation, new Date()) !== null;
  }

  handleCodexHook(
    observation: CodexHookObservation,
    observedAt = new Date()
  ): CodexHookResult {
    const accepted = this.acceptCodexHook(observation, observedAt);
    if (!accepted) {
      return { accepted: false };
    }
    if (accepted.cwd !== accepted.root) {
      return { accepted: true };
    }
    try {
      const worktree = this.inspect(accepted.root).worktrees.find(
        ({ path }) => path === accepted.cwd
      );
      const additionalContext = worktree
        ? this.codexContext.share(observation, worktree, observedAt)
        : undefined;
      return additionalContext
        ? { accepted: true, additionalContext }
        : { accepted: true };
    } catch {
      return { accepted: true };
    }
  }

  private acceptCodexHook(
    observation: CodexHookObservation,
    observedAt: Date
  ): { cwd: string; root: string } | null {
    try {
      const cwd = realpathSync(observation.cwd);
      const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
      if (!this.codexEnabledWorktree(root)) {
        return null;
      }
      this.codexActivity.observe({ ...observation, cwd }, observedAt);
      if (!this.knownCodexTasksByPath.get(cwd)?.has(observation.sessionId)) {
        const pending = this.pendingCodexObservations.get(root) ?? new Map();
        pending.set(`${cwd}\0${observation.sessionId}`, {
          cwd,
          sessionId: observation.sessionId,
        });
        this.pendingCodexObservations.set(root, pending);
        this.requestCodexRefresh(root);
      }
      return { cwd, root };
    } catch {
      return null;
    }
  }

  async execute<Name extends WorkgroveCommandName>(
    command: Name,
    input: unknown
  ): Promise<WorkgroveCommandResult<Name>> {
    const handler = COMMAND_HANDLERS[command];
    const parsed = parseCommandInput(command, input);
    const result = await handler(
      this,
      parsed as WorkgroveCommandInput<Name> & Record<string, unknown>
    );
    return parseCommandResult(command, result);
  }

  inspect(repoPath: string): WorkspaceSnapshot {
    const selectedRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
    const configPath = findWorkgroveConfig(selectedRoot);
    if (!configPath) {
      throw new MissingWorktreeConfigError(
        join(selectedRoot, ".workgrove.json")
      );
    }
    const configDocument = loadWorkgroveConfigDocument(configPath);
    const config = configDocument.config;
    const discovered = parseWorktreeList(
      git(selectedRoot, ["worktree", "list", "--porcelain"])
    ).filter((item) => !item.prunable && existsSync(item.path));
    if (discovered.length === 0) {
      throw new Error("No Git worktrees were discovered");
    }

    const primaryGroupId = primaryAppGroup(config);
    const ports = inspectListeningPorts();
    const worktrees = discovered.map((item, index) => {
      const path = realpathSync(item.path);
      const id = worktreeId(path);
      const appGroups = Object.entries(config.appGroups).map(
        ([groupId, configured]) => {
          const key = this.runKey(selectedRoot, path, groupId);
          const run = this.state.run(key);
          const processRunning =
            managedPid(appGroupProcessId(id, groupId), path) !== null;
          const apps = Object.entries(configured.apps).map(([appId, app]) =>
            this.inspectEndpoint({
              app,
              appId,
              config,
              groupId,
              item,
              ports,
              repoPath: selectedRoot,
              run: run?.apps[appId] ?? null,
              stop: configured.stop,
              worktreePath: path,
            })
          );
          return {
            apps,
            health: groupHealth(apps),
            id: groupId,
            name: displayName(groupId, configured),
            processRunning,
            stop:
              configured.stop === "process"
                ? ("process" as const)
                : ("command" as const),
          };
        }
      );
      const primary =
        appGroups.find((group) => group.id === primaryGroupId) ?? appGroups[0];
      return {
        appGroups,
        appLabel: primary.name,
        apps: primary.apps,
        branch:
          item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
        health: primary.health,
        id,
        isMain: index === 0,
        name: basename(path),
        path,
        processRunning: primary.processRunning,
        setupState: worktreeSetupState(id, path),
      };
    });

    const globalProcesses = listManagedProcesses();
    const lifecycleCommands = Object.entries(config.appGroups).flatMap(
      ([groupId, group]) => [
        commandSummary(`${displayName(groupId, group)} Start`, group.start),
        ...(group.stop === "process"
          ? []
          : [
              commandSummary(`${displayName(groupId, group)} Stop`, group.stop),
            ]),
      ]
    );
    return {
      config,
      configPath,
      configRevision: configDocument.revision,
      globalProcesses,
      globalRunningCount: worktrees.reduce(
        (count, worktree) =>
          count +
          worktree.appGroups.filter(
            (group) => group.processRunning || group.health !== "not-running"
          ).length,
        0
      ),
      mainWorktreePath: worktrees[0].path,
      primaryAppGroup: primaryGroupId,
      repoName: basename(worktrees[0].path),
      repoPath: selectedRoot,
      trustCommands: [
        commandSummary("Setup", config.setup),
        ...lifecycleCommands,
      ],
      trustRequired: repositoryRequiresTrust(config),
      trusted: repositoryIsTrusted(selectedRoot, config),
      updatedAt: new Date().toISOString(),
      worktrees,
    };
  }

  async startAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-running" | "started"> {
    this.assertTrusted(repoPath);
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    const config = workspace.config;
    const group = config.appGroups[groupId];
    if (!group) {
      throw new Error(`Unknown App group "${groupId}"`);
    }
    const key = this.runKey(workspace.repoPath, worktree.path, groupId);
    let run = this.state.run(key);
    const allocatedNow = run === null;
    if (!run) {
      const apps: Record<string, RunEndpoint> = {};
      const leased = this.state.leasedPorts();
      const reservations: BackingPortLease[] = [];
      try {
        for (const [appId, app] of Object.entries(group.apps)) {
          const assignment = this.endpointAssignment({
            app,
            appId,
            config,
            groupId,
            item: { branch: worktree.branch },
            repoPath: workspace.repoPath,
            worktreePath: worktree.path,
          });
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
        run = { apps, createdAt: new Date().toISOString(), groupId };
        this.state.saveRun(key, run);
      } finally {
        await Promise.all(
          reservations.map((reservation) => reservation.release())
        );
      }
    }

    const allReady = await Promise.all(
      Object.entries(group.apps).map(([appId, app]) =>
        appIsReady(app, run?.apps[appId] as RunEndpoint)
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
          portOwnership(ports, endpoint.port, worktree.path) === "foreign"
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

    const processId = appGroupProcessId(worktree.id, groupId);
    if (
      managedPid(processId, worktree.path) === null &&
      !allReady.some(Boolean)
    ) {
      const command = resolveStartCommand(
        config,
        groupId,
        this.templateGroups(config, workspace.repoPath, worktree.path, run)
      );
      const cwd = this.commandWorkingDirectory(worktree.path, command.cwd);
      startManagedProcess({
        argv: command.argv,
        cwd,
        env: command.env,
        logId: processId,
        label: displayName(groupId, group),
        ownerId: processId,
        ownerRoot: worktree.path,
        trackExitFailure: true,
        worktreeId: processId,
      });
    }

    await Promise.all(
      Object.entries(group.apps).map(([appId, app]) =>
        waitForAppReadiness(app, run?.apps[appId] as RunEndpoint)
      )
    );
    if (group.stop === "process") {
      const ports = inspectListeningPorts();
      const unowned = Object.values(run.apps).find(
        (endpoint) =>
          portOwnership(ports, endpoint.port, worktree.path) !== "owned"
      );
      if (unowned) {
        throw new Error(
          `Backing endpoint ${unowned.port} became ready outside this worktree; no Friendly URLs were published`
        );
      }
    }
    await this.activateRoutes(run);
    return "started";
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route, command, process, and quarantine failures must be accumulated in lifecycle order.
  async stopAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-stopped" | "stopped"> {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    const config = workspace.config;
    const group = config.appGroups[groupId];
    if (!group) {
      throw new Error(`Unknown App group "${groupId}"`);
    }
    const key = this.runKey(workspace.repoPath, worktree.path, groupId);
    const run = this.state.run(key);
    const processId = appGroupProcessId(worktree.id, groupId);
    if (!run && managedPid(processId, worktree.path) === null) {
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
      this.assertTrusted(repoPath);
      try {
        const command = resolveStopCommand(
          config,
          groupId,
          this.templateGroups(config, workspace.repoPath, worktree.path, run)
        );
        if (!command) {
          throw new Error(`${displayName(groupId, group)} has no Stop command`);
        }
        await runFiniteCommand({
          argv: command.argv,
          cwd: this.commandWorkingDirectory(worktree.path, command.cwd),
          env: command.env,
          label: `Stop ${displayName(groupId, group)}`,
          logId: processId,
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    await stopManagedProcess(processId, worktree.path);
    if (group.stop === "process" && run) {
      const killed = new Set<number>();
      for (const pid of ownedPortPids(
        inspectListeningPorts(),
        Object.values(run.apps).map((app) => app.port),
        worktree.path
      )) {
        if (await stopOwnedProcess(pid, processId)) {
          killed.add(pid);
        }
      }
      if (killed.size > 0) {
        appendManagedLog(
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

  config(repoPath: string): WorktreeEnvConfig {
    const root = git(repoPath, ["rev-parse", "--show-toplevel"]);
    const path = findWorkgroveConfig(root);
    if (!path) {
      throw new MissingWorktreeConfigError(join(root, ".workgrove.json"));
    }
    return loadWorkgroveConfig(path);
  }

  updateConfiguration(
    repoPath: string,
    config: WorkgroveConfig,
    revision: string
  ): void {
    const workspace = this.inspect(repoPath);
    const topologyChanged =
      JSON.stringify(workspace.config.appGroups) !==
      JSON.stringify(config.appGroups);
    const hasRunningProcesses = workspace.worktrees.some(
      (worktree) =>
        worktree.setupState === "running" ||
        worktree.appGroups.some(
          (group) => group.processRunning || group.health !== "not-running"
        )
    );
    if (topologyChanged && hasRunningProcesses) {
      throw new Error(
        "Stop repository App groups and setup processes before changing their configuration."
      );
    }
    updateWorkgroveConfig(workspace.configPath, config, revision);
  }

  assertTrusted(repoPath: string): void {
    const workspace = this.inspect(repoPath);
    if (!workspace.trusted) {
      throw new Error("Review and trust this repository's commands first");
    }
  }

  worktree(repoPath: string, id: string) {
    const workspace = this.inspect(repoPath);
    const worktree = workspace.worktrees.find((item) => item.id === id);
    if (!worktree) {
      throw new Error("Unknown worktree");
    }
    return { workspace, worktree };
  }

  logs(repoPath: string, id: string, appGroupId?: string): string[] {
    this.worktree(repoPath, id);
    return readManagedLog(appGroupId ? appGroupProcessId(id, appGroupId) : id);
  }

  commandWorkingDirectory(worktreePath: string, relativeCwd?: string): string {
    const root = realpathSync(worktreePath);
    let cwd: string;
    try {
      cwd = realpathSync(relativeCwd ? resolve(root, relativeCwd) : root);
    } catch {
      throw new Error(
        "Command working directory must exist inside the worktree"
      );
    }
    if (!pathInside(cwd, root)) {
      throw new Error(
        "Command working directory must stay inside the worktree"
      );
    }
    return cwd;
  }

  private endpointAssignment(input: {
    app: WorkgroveApp;
    appId: string;
    config: WorkgroveConfig;
    groupId: string;
    item: { branch: string | null };
    repoPath: string;
    worktreePath: string;
  }): EndpointAssignment {
    return this.state.endpoint({
      appId: input.appId,
      appLabel: displayName(input.appId, input.app),
      groupId: input.groupId,
      repoLabel: basename(input.repoPath),
      repoPath: input.repoPath,
      worktreeLabel: worktreeRouteLabel(input.item, input.worktreePath),
      worktreePath: input.worktreePath,
    });
  }

  private inspectEndpoint(input: {
    app: WorkgroveApp;
    appId: string;
    config: WorkgroveConfig;
    groupId: string;
    item: { branch: string | null };
    ports: ReturnType<typeof inspectListeningPorts>;
    repoPath: string;
    run: RunEndpoint | null;
    stop: WorkgroveConfig["appGroups"][string]["stop"];
    worktreePath: string;
  }): AppEndpointSnapshot {
    this.endpointAssignment(input);
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
      input.worktreePath
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

  private runKey(
    repoPath: string,
    worktreePath: string,
    groupId: string
  ): RunKey {
    return { groupId, repoPath, worktreePath };
  }

  private templateGroups(
    config: WorkgroveConfig,
    repoPath: string,
    worktreePath: string,
    currentRun: { apps: Record<string, RunEndpoint>; groupId: string } | null
  ): ResolvedWorkgroveAppGroups {
    return Object.fromEntries(
      Object.entries(config.appGroups).map(([groupId, group]) => [
        groupId,
        {
          apps: Object.fromEntries(
            Object.entries(group.apps).map(([appId, app]) => {
              const assignment = this.state.endpoint({
                appId,
                appLabel: displayName(appId, app),
                groupId,
                repoLabel: basename(repoPath),
                repoPath,
                worktreeLabel: basename(worktreePath),
                worktreePath,
              });
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

  private endpointRoute(endpoint: RunEndpoint): LocalRoute {
    if (!endpoint.hostname) {
      throw new Error(`${endpoint.appId} does not have a Friendly hostname`);
    }
    return { hostname: endpoint.hostname, port: endpoint.port };
  }

  private codexEnabledWorktree(path: string): boolean {
    try {
      const root = realpathSync(path);
      const configPath = findWorkgroveConfig(root);
      if (!configPath) {
        return false;
      }
      loadWorkgroveConfigDocument(configPath);
      return true;
    } catch {
      return false;
    }
  }

  private requestCodexRefresh(root: string): void {
    if (this.codexRefreshes.has(root)) {
      return;
    }
    const refresh = this.inspectCodex(root, { force: true })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.discardUnmatchedCodexObservations(root);
        if (this.codexRefreshes.get(root) === refresh) {
          this.codexRefreshes.delete(root);
        }
      });
    this.codexRefreshes.set(root, refresh);
  }

  private discardUnmatchedCodexObservations(root: string): void {
    const pending = this.pendingCodexObservations.get(root);
    this.pendingCodexObservations.delete(root);
    for (const observation of pending?.values() ?? []) {
      if (
        !this.knownCodexTasksByPath
          .get(observation.cwd)
          ?.has(observation.sessionId)
      ) {
        this.codexActivity.discard(observation.cwd, observation.sessionId);
        this.codexContext.discard(observation.cwd, observation.sessionId);
      }
    }
  }
}
