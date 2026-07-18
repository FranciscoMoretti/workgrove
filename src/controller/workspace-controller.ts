import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CodexHookActivityStore,
  type CodexHookObservation,
} from "../codex/codex-hook-activity";
import {
  type CodexIntegrationAdapter,
  type CodexIntegrationSnapshot,
  projectCodexIntegration,
} from "../codex/codex-integration";
import { CodexTaskDiscoveryAdapter } from "../codex/codex-task-discovery";
import { clearLogs } from "../commands/clear-logs";
import { createWorktree } from "../commands/create-worktree";
import { deleteWorktree } from "../commands/delete-worktree";
import { initializeRepository } from "../commands/initialize-repository";
import { pickRepository } from "../commands/pick-repository";
import { previewRepositoryConfig } from "../commands/preview-repository-config";
import { restartApps } from "../commands/restart-apps";
import { restartRunningApps } from "../commands/restart-running-apps";
import { setSlot } from "../commands/set-slot";
import { setupAllApps } from "../commands/setup-all-apps";
import { startAllApps } from "../commands/start-all-apps";
import { startApps } from "../commands/start-apps";
import { stopAllApps } from "../commands/stop-all-apps";
import { stopApps } from "../commands/stop-apps";
import { switchSlot } from "../commands/switch-slot";
import { trustRepository } from "../commands/trust-repository";
import { updateRepositoryConfig } from "../commands/update-repository-config";
import {
  repositoryIsTrusted,
  repositoryRequiresTrust,
} from "../config/repository-trust";
import type { WorkgroveCommand } from "../config/workgrove-command";
import {
  defaultWorkgroveSlots,
  findWorkgroveConfig,
  loadWorkgroveConfig,
  loadWorkgroveConfigDocument,
  updateWorkgroveConfig,
  type WorkgroveSlotAssignments,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import {
  maximumWorkgroveAppGroupSlot,
  WORKGROVE_LEGACY_SLOT_FILE,
  WORKGROVE_SLOTS_FILE,
  type WorkgroveConfig,
} from "../config/workgrove-schema";
import { parseWorktreeList } from "../git/discover-worktrees";
import { appHealth, resolveControlledApps } from "../runtime/app-health";
import { commandEnvironment } from "../runtime/command-environment";
import { inspectListeningPorts, portOwnership } from "../runtime/ports";
import {
  appGroupProcessId,
  listManagedProcesses,
  managedFailure,
  managedPid,
  readManagedLog,
  setupProcessId,
} from "../runtime/process-supervisor";
import {
  parseLegacySlot,
  parseSlotAssignments,
  resolveSlotFilePath,
} from "../runtime/slot-file";
import {
  parseCommandInput,
  parseCommandResult,
  type WorkgroveCommandInput,
  type WorkgroveCommandName,
  type WorkgroveCommandResult,
} from "./command-contract";
import type { WorkspaceSnapshot } from "./workspace-snapshot";

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
  "set-slot": setSlot,
  "setup-all-apps": setupAllApps,
  "start-all-apps": startAllApps,
  "start-apps": startApps,
  "stop-all-apps": stopAllApps,
  "stop-apps": stopApps,
  "switch-slot": switchSlot,
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

function fileContent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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

function worktreeSlots(
  path: string,
  config: WorkgroveConfig,
  primaryGroup: string
): { invalid: boolean; slots: WorkgroveSlotAssignments } {
  const defaults = defaultWorkgroveSlots(config);
  const statePath = resolveSlotFilePath(path, WORKGROVE_SLOTS_FILE);
  const parsed = parseSlotAssignments(fileContent(statePath));
  let overrides: Record<string, number> = {};
  if (parsed.kind === "value") {
    overrides = parsed.slots;
  } else if (parsed.kind === "missing") {
    const legacyPath = resolveSlotFilePath(path, WORKGROVE_LEGACY_SLOT_FILE);
    const legacy = parseLegacySlot(fileContent(legacyPath));
    if (legacy !== null) {
      overrides = { [primaryGroup]: legacy };
    }
  }
  return {
    invalid: parsed.kind === "invalid",
    slots: { ...defaults, ...overrides },
  };
}

function appGroupInstanceKey(name: string, slot: number): string {
  return `${name}\0${slot}`;
}

export interface WorkspaceControllerRuntimeOptions {
  codexHooks?: CodexHookActivityStore;
}

export class WorkspaceController {
  private readonly codexAdapter: CodexIntegrationAdapter;
  private readonly codexActivity: CodexHookActivityStore;
  private readonly codexRefreshes = new Map<string, Promise<void>>();
  private readonly knownCodexTasksByPath = new Map<string, Set<string>>();
  private readonly pendingCodexObservations = new Map<
    string,
    Map<string, { cwd: string; sessionId: string }>
  >();

  constructor(
    codexAdapter: CodexIntegrationAdapter = new CodexTaskDiscoveryAdapter(),
    runtime: WorkspaceControllerRuntimeOptions = {}
  ) {
    this.codexAdapter = codexAdapter;
    this.codexActivity = runtime.codexHooks ?? new CodexHookActivityStore();
  }

  close(): Promise<void> {
    return this.codexAdapter.close();
  }

  async inspectCodex(repoPath: string): Promise<CodexIntegrationSnapshot> {
    const workspace = this.inspect(repoPath);
    const worktrees = workspace.worktrees.map(({ id, path }) => ({ id, path }));
    const discovered = await this.codexAdapter.loadAssociatedTasks(worktrees);
    for (const { path } of worktrees) {
      this.knownCodexTasksByPath.set(path, new Set());
    }
    for (const { task, worktreePath } of discovered.tasks) {
      this.knownCodexTasksByPath.get(worktreePath)?.add(task.id);
    }
    const adapterSnapshot = this.codexActivity.applyToSnapshot(
      discovered,
      new Date(),
      (worktreePath) => this.codexEnabledWorktree(worktreePath)
    );
    return projectCodexIntegration(worktrees, adapterSnapshot);
  }

  observeCodexHook(observation: CodexHookObservation): boolean {
    try {
      const cwd = realpathSync(observation.cwd);
      const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
      if (!this.codexEnabledWorktree(root)) {
        return false;
      }
      this.codexActivity.observe({ ...observation, cwd });
      if (!this.knownCodexTasksByPath.get(cwd)?.has(observation.sessionId)) {
        const pending = this.pendingCodexObservations.get(root) ?? new Map();
        pending.set(`${cwd}\0${observation.sessionId}`, {
          cwd,
          sessionId: observation.sessionId,
        });
        this.pendingCodexObservations.set(root, pending);
        this.requestCodexRefresh(root);
      }
      return true;
    } catch {
      return false;
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

    const primaryGroup = primaryAppGroup(config);
    const ports = inspectListeningPorts();
    const discoveredWorktrees = discovered.map((item) => {
      const id = worktreeId(item.path);
      const path = realpathSync(item.path);
      const resolvedSlots = worktreeSlots(path, config, primaryGroup);
      return { id, item, path, resolvedSlots };
    });
    const instances = new Map<string, number[]>();
    for (const { resolvedSlots } of discoveredWorktrees) {
      for (const [name, configured] of Object.entries(config.appGroups)) {
        const slot = resolvedSlots.slots[name] ?? configured.slot.default;
        if (
          resolvedSlots.invalid ||
          slot > maximumWorkgroveAppGroupSlot(configured)
        ) {
          continue;
        }
        const key = appGroupInstanceKey(name, slot);
        if (!instances.has(key)) {
          instances.set(
            key,
            resolveControlledApps(config, name, slot).map((app) => app.port)
          );
        }
      }
    }
    const instanceKeysByPort = new Map<number, Set<string>>();
    for (const [key, instancePorts] of instances) {
      for (const port of instancePorts) {
        const keys = instanceKeysByPort.get(port) ?? new Set<string>();
        keys.add(key);
        instanceKeysByPort.set(port, keys);
      }
    }
    const conflictingInstances = new Set(
      [...instanceKeysByPort.values()]
        .filter((keys) => keys.size > 1)
        .flatMap((keys) => [...keys])
    );
    const worktrees = discoveredWorktrees.map(
      ({ id, item, path, resolvedSlots }, index) => {
        const resolvedGroups = Object.entries(config.appGroups).map(
          ([name, configured]) => {
            const slot = resolvedSlots.slots[name] ?? configured.slot.default;
            const slotInvalid =
              resolvedSlots.invalid ||
              slot > maximumWorkgroveAppGroupSlot(configured);
            const controlledApps = slotInvalid
              ? []
              : resolveControlledApps(config, name, slot);
            return { configured, controlledApps, name, slot, slotInvalid };
          }
        );
        const appGroups = resolvedGroups.map(
          ({ configured, controlledApps, name, slot, slotInvalid }) => {
            const portCollision = conflictingInstances.has(
              appGroupInstanceKey(name, slot)
            );
            const invalid = slotInvalid || portCollision;
            const commandControlled = configured.stop !== "process";
            const apps = invalid
              ? []
              : controlledApps.map((app) => {
                  const ownership = portOwnership(ports, app.port, path);
                  return {
                    ...app,
                    listening: commandControlled
                      ? ownership !== "none"
                      : ownership === "owned",
                    ownership,
                  };
                });
            const listening = new Set(
              apps.filter((app) => app.listening).map((app) => app.port)
            );
            let slotState: "assigned" | "conflicting" | "invalid" = "assigned";
            if (portCollision) {
              slotState = "conflicting";
            }
            if (slotInvalid) {
              slotState = "invalid";
            }
            return {
              apps,
              health: appHealth(invalid ? [] : controlledApps, listening),
              name,
              processRunning:
                configured.stop === "process" &&
                managedPid(appGroupProcessId(id, name), path) !== null,
              slot,
              slotState,
              stop: commandControlled
                ? ("command" as const)
                : ("process" as const),
            };
          }
        );
        const primary =
          appGroups.find((group) => group.name === primaryGroup) ??
          appGroups[0];
        return {
          appLabel: primary.name,
          apps: primary.apps,
          appGroups,
          branch:
            item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
          health: primary.health,
          id,
          isMain: index === 0,
          name: basename(path),
          path,
          processRunning: primary.processRunning,
          setupState: worktreeSetupState(id, path),
          slot: primary.slot,
          slotState: primary.slotState,
        };
      }
    );

    const appGroupSlotOptions = Object.fromEntries(
      Object.entries(config.appGroups).map(([name, configured]) => {
        const occupied = new Set(
          worktrees.map(
            (worktree) =>
              worktree.appGroups.find((group) => group.name === name)?.slot ??
              configured.slot.default
          )
        );
        const visible = new Set(occupied);
        const maximum = maximumWorkgroveAppGroupSlot(configured);
        for (
          let slot = 0;
          slot <= maximum && visible.size < occupied.size + 12;
          slot += 1
        ) {
          visible.add(slot);
        }
        return [
          name,
          [...visible]
            .sort((left, right) => left - right)
            .map((slot) => ({
              apps: resolveControlledApps(config, name, slot).map((app) => ({
                label: app.label,
                port: app.port,
              })),
              collisionOwners: [],
              slot,
            })),
        ];
      })
    );

    const globalProcesses = listManagedProcesses();
    const lifecycleCommands = Object.entries(config.appGroups).flatMap(
      ([name, group]) => [
        commandSummary(`${name} Start`, group.start),
        ...(group.stop === "process"
          ? []
          : [commandSummary(`${name} Stop`, group.stop)]),
      ]
    );
    return {
      appGroupSlotOptions,
      config,
      configPath,
      configRevision: configDocument.revision,
      defaultSlot: config.appGroups[primaryGroup].slot.default,
      globalProcesses,
      globalRunningCount: globalProcesses.length,
      mainWorktreePath: worktrees[0].path,
      primaryAppGroup: primaryGroup,
      repoName: basename(worktrees[0].path),
      repoPath: selectedRoot,
      slotFile: WORKGROVE_SLOTS_FILE,
      slotOptions: appGroupSlotOptions[primaryGroup],
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
    const topology = (value: WorkgroveConfig) => value.appGroups;
    const topologyChanged =
      JSON.stringify(topology(workspace.config)) !==
      JSON.stringify(topology(config));
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

  environment(
    repoPath: string,
    slots: Record<string, number>
  ): Record<string, string> {
    return commandEnvironment(this.config(repoPath), slots);
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

  logs(repoPath: string, id: string, appGroupName?: string): string[] {
    this.worktree(repoPath, id);
    return readManagedLog(
      appGroupName ? appGroupProcessId(id, appGroupName) : id
    );
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
    const refresh = this.inspectCodex(root)
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
      }
    }
  }
}
