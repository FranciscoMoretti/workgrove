import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
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
import { initializeRepository as initializeRepositoryCommand } from "../commands/initialize-repository";
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
  trustRepository as saveRepositoryTrust,
} from "../config/repository-trust";
import type { WorkgroveCommand } from "../config/workgrove-command";
import {
  findWorkgroveConfig,
  loadWorkgroveConfig,
  loadWorkgroveConfigDocument,
  resolveSetupCommand,
  updateWorkgroveConfig,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import type { WorkgroveConfig } from "../config/workgrove-schema";
import { parseWorktreeList } from "../git/discover-worktrees";
import {
  type LocalRoutingEngine,
  PortlessRoutingEngine,
} from "../runtime/local-routing";
import { FileWorkgroveStateStore } from "../runtime/local-state";
import { inspectListeningPorts } from "../runtime/ports";
import {
  appGroupProcessId,
  ProcessSupervisor,
  setupProcessId,
} from "../runtime/process-supervisor";
import { AppGroupRuntime, type AppGroupTarget } from "./app-group-runtime";
import {
  parseCommandInput,
  parseCommandResult,
  type WorkgroveCommandInput,
  type WorkgroveCommandName,
  type WorkgroveCommandResult,
} from "./command-contract";
import { initializeRepository as initializeRepositoryConfig } from "./repository-initializer";
import type { WorkspaceSnapshot } from "./workspace-snapshot";
import { commandWorkingDirectory } from "./worktree-command";

type CommandHandler = (
  controller: WorkspaceController,
  input: Record<string, unknown>
) => unknown;

const COMMAND_HANDLERS: Record<WorkgroveCommandName, CommandHandler> = {
  "clear-logs": clearLogs,
  "create-worktree": createWorktree,
  "delete-worktree": deleteWorktree,
  "initialize-repository": initializeRepositoryCommand,
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
  path: string,
  processes: ProcessSupervisor
): "failed" | "idle" | "running" {
  const processId = setupProcessId(id);
  if (processes.managedPid(processId, path) !== null) {
    return "running";
  }
  return processes.managedFailure(processId) ? "failed" : "idle";
}

function primaryAppGroup(config: WorkgroveConfig): string {
  const entries = Object.entries(config.appGroups);
  return (
    entries.find(([, group]) => group.stop === "process")?.[0] ?? entries[0][0]
  );
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

export interface WorkspaceControllerRuntimeOptions {
  codexContext?: CodexContextStore;
  codexHooks?: CodexHookActivityStore;
  processes?: ProcessSupervisor;
  routing?: LocalRoutingEngine;
  state?: FileWorkgroveStateStore;
}

export interface CodexHookResult {
  accepted: boolean;
  additionalContext?: string;
}

export class WorkspaceController {
  private readonly appGroups: AppGroupRuntime;
  private readonly codexAdapter: CodexIntegrationAdapter;
  private readonly codexActivity: CodexHookActivityStore;
  private readonly codexContext: CodexContextStore;
  private readonly codexRefreshes = new Map<string, Promise<void>>();
  private readonly knownCodexTasksByPath = new Map<string, Set<string>>();
  private readonly pendingCodexObservations = new Map<
    string,
    Map<string, { cwd: string; sessionId: string }>
  >();
  private readonly processes: ProcessSupervisor;
  private readonly routing: LocalRoutingEngine;
  private readonly state: FileWorkgroveStateStore;

  constructor(
    codexAdapter: CodexIntegrationAdapter = new CodexTaskDiscoveryAdapter(),
    runtime: WorkspaceControllerRuntimeOptions = {}
  ) {
    this.codexAdapter = codexAdapter;
    this.codexActivity = runtime.codexHooks ?? new CodexHookActivityStore();
    this.codexContext = runtime.codexContext ?? new CodexContextStore();
    this.processes = runtime.processes ?? new ProcessSupervisor();
    this.routing = runtime.routing ?? new PortlessRoutingEngine();
    this.state = runtime.state ?? new FileWorkgroveStateStore();
    this.appGroups = new AppGroupRuntime(
      this.processes,
      this.routing,
      this.state
    );
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
      const appGroups = Object.keys(config.appGroups).map((groupId) =>
        this.appGroups.inspect(
          {
            config,
            groupId,
            repoPath: selectedRoot,
            worktree: {
              id,
              path,
              routeLabel: worktreeRouteLabel(item, path),
            },
          },
          ports
        )
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
        setupState: worktreeSetupState(id, path, this.processes),
      };
    });

    const globalProcesses = this.processes.listManagedProcesses();
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
      trusted: repositoryIsTrusted(
        selectedRoot,
        config,
        this.processes.controlDirectory
      ),
      updatedAt: new Date().toISOString(),
      worktrees,
    };
  }

  startAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-running" | "started"> {
    this.assertTrusted(repoPath);
    return this.appGroups.start(
      this.appGroupTarget(repoPath, worktreeIdValue, groupId)
    );
  }

  stopAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-stopped" | "stopped"> {
    const target = this.appGroupTarget(repoPath, worktreeIdValue, groupId);
    if (target.config.appGroups[groupId]?.stop !== "process") {
      this.assertTrusted(repoPath);
    }
    return this.appGroups.stop(target);
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

  trustRepository(repoPath: string): void {
    const workspace = this.inspect(repoPath);
    saveRepositoryTrust(
      workspace.repoPath,
      workspace.config,
      this.processes.controlDirectory
    );
  }

  initializeRepository(repoPath: string) {
    return initializeRepositoryConfig(repoPath, {
      controlDirectory: this.processes.controlDirectory,
    });
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
    return this.processes.readManagedLog(
      appGroupId ? appGroupProcessId(id, appGroupId) : id
    );
  }

  startSetup(repoPath: string, worktreeIdValue: string): void {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    const setup = resolveSetupCommand(workspace.config);
    this.processes.appendManagedLog(
      worktree.id,
      `[workgrove] Running setup: ${setup.argv.join(" ")}`
    );
    this.processes.startManagedProcess({
      argv: setup.argv,
      cwd: commandWorkingDirectory(worktree.path, setup.cwd),
      env: setup.env,
      label: "Setup",
      logId: worktree.id,
      ownerId: worktree.id,
      ownerRoot: worktree.path,
      trackExitFailure: true,
      processId: setupProcessId(worktree.id),
    });
  }

  clearLogs(repoPath: string, worktreeIdValue: string, groupId: string): void {
    this.worktree(repoPath, worktreeIdValue);
    this.processes.clearManagedLog(appGroupProcessId(worktreeIdValue, groupId));
  }

  private appGroupTarget(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): AppGroupTarget {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    if (!workspace.config.appGroups[groupId]) {
      throw new Error(`Unknown App group "${groupId}"`);
    }
    return {
      config: workspace.config,
      groupId,
      repoPath: workspace.repoPath,
      worktree: {
        id: worktree.id,
        path: worktree.path,
        routeLabel: worktree.branch,
      },
    };
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
