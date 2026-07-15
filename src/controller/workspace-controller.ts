import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
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
  updateWorkgroveConfig,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import {
  maximumWorkgroveSlot,
  WORKGROVE_DEFAULT_SLOT,
  WORKGROVE_SLOT_ENV,
  WORKGROVE_SLOT_FILE,
  type WorkgroveConfig,
} from "../config/workgrove-schema";
import { parseWorktreeList } from "../git/discover-worktrees";
import { appHealth, resolveControlledApps } from "../runtime/app-health";
import { commandEnvironment } from "../runtime/command-environment";
import { inspectListeningPorts, portOwnership } from "../runtime/ports";
import {
  listManagedProcesses,
  managedFailure,
  managedPid,
  readManagedLog,
  setupProcessId,
} from "../runtime/process-supervisor";
import {
  type ParsedSlot,
  parseSlotFromContent,
  resolveSlotFilePath,
} from "../runtime/slot-file";
import {
  parseCommandInput,
  parseCommandResult,
  type WorkgroveCommandInput,
  type WorkgroveCommandName,
  type WorkgroveCommandResult,
} from "./command-contract";
import {
  conflictingWorkgroveSlotIndexes,
  workgroveSlotCollisionOwners,
} from "./slot-collisions";
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

function slotContent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function commandSummary(label: string, command: WorkgroveCommand): string {
  return `${label}: ${command.argv.join(" ")}`;
}

function slotState(
  parsed: ParsedSlot,
  slot: number | null,
  index: number,
  conflictingIndexes: ReadonlySet<number>
): "assigned" | "conflicting" | "invalid" | "unassigned" {
  if (parsed.kind === "invalid") {
    return "invalid";
  }
  if (slot === null) {
    return "unassigned";
  }
  return conflictingIndexes.has(index) ? "conflicting" : "assigned";
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

export class WorkspaceController {
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
    const setupCommand = config.setup;
    const discovered = parseWorktreeList(
      git(selectedRoot, ["worktree", "list", "--porcelain"])
    ).filter((item) => !item.prunable && existsSync(item.path));
    if (discovered.length === 0) {
      throw new Error("No Git worktrees were discovered");
    }
    const maxSlot = maximumWorkgroveSlot(config);
    const slotFile = WORKGROVE_SLOT_FILE;
    const parsedSlots = discovered.map((item) => {
      const file = resolveSlotFilePath(item.path, slotFile);
      const parsed = parseSlotFromContent(
        slotContent(file),
        WORKGROVE_SLOT_ENV
      );
      return parsed.kind === "value" && parsed.slot > maxSlot
        ? ({ kind: "invalid", raw: String(parsed.slot) } as const)
        : parsed;
    });
    const rawSlots = parsedSlots.map((parsed) =>
      parsed.kind === "value" ? parsed.slot : null
    );
    const conflictingSlotIndexes = conflictingWorkgroveSlotIndexes(
      config,
      rawSlots
    );
    const ports = inspectListeningPorts();
    const appLabel = resolveControlledApps(config, WORKGROVE_DEFAULT_SLOT)
      .map((app) => app.label)
      .join(" + ");
    const worktrees = discovered.map((item, index) => {
      const id = worktreeId(item.path);
      const path = realpathSync(item.path);
      const slot = rawSlots[index];
      const controlledApps =
        slot === null ? [] : resolveControlledApps(config, slot);
      const apps = controlledApps.map((app) => {
        const ownership = portOwnership(ports, app.port, item.path);
        return { ...app, listening: ownership === "owned", ownership };
      });
      const listening = new Set(
        apps.filter((app) => app.listening).map((app) => app.port)
      );
      return {
        appLabel: appLabel || "Apps",
        apps,
        branch:
          item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
        health: appHealth(controlledApps, listening),
        id,
        isMain: index === 0,
        name: basename(item.path),
        path,
        processRunning: managedPid(id, path) !== null,
        setupState: worktreeSetupState(id, path),
        slot,
        slotState: slotState(
          parsedSlots[index],
          slot,
          index,
          conflictingSlotIndexes
        ),
      };
    });
    const occupied = new Map<number, string>();
    for (const worktree of worktrees) {
      if (worktree.slot !== null && !occupied.has(worktree.slot)) {
        occupied.set(worktree.slot, worktree.name);
      }
    }
    const visibleSlots = new Set<number>(occupied.keys());
    const unassignedCount = worktrees.filter(
      (worktree) => worktree.slotState === "unassigned"
    ).length;
    const suggestedSlotCount = Math.max(12, unassignedCount + 3);
    for (
      let slot = 0;
      slot <= maxSlot && visibleSlots.size < occupied.size + suggestedSlotCount;
      slot += 1
    ) {
      visibleSlots.add(slot);
    }
    const assignedSlots = worktrees.flatMap((worktree) =>
      worktree.slot === null
        ? []
        : [{ id: worktree.id, name: worktree.name, slot: worktree.slot }]
    );
    const slotOptions = [...visibleSlots]
      .sort((left, right) => left - right)
      .map((slot) => {
        const collisionOwners = workgroveSlotCollisionOwners(
          config,
          slot,
          assignedSlots
        );
        return {
          apps: resolveControlledApps(config, slot)
            .filter((app) => app.probe === "tcp")
            .map((app) => ({ label: app.label, port: app.port })),
          collisionOwners: collisionOwners.map(({ id, name }) => ({
            id,
            name,
          })),
          slot,
        };
      });
    const globalProcesses = listManagedProcesses();
    return {
      config,
      configPath,
      configRevision: configDocument.revision,
      globalProcesses,
      globalRunningCount: globalProcesses.length,
      defaultSlot: WORKGROVE_DEFAULT_SLOT,
      mainWorktreePath: worktrees[0].path,
      repoName: basename(worktrees[0].path),
      repoPath: selectedRoot,
      slotEnv: WORKGROVE_SLOT_ENV,
      slotFile,
      slotOptions,
      trustCommands: [
        commandSummary("Setup", setupCommand),
        commandSummary("Apps", config.start),
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
    const topology = (value: WorkgroveConfig) => ({
      apps: Object.fromEntries(
        Object.entries(value.apps).map(([id, app]) => [id, app.basePort])
      ),
    });
    const topologyChanged =
      JSON.stringify(topology(workspace.config)) !==
      JSON.stringify(topology(config));
    const hasRunningProcesses = workspace.worktrees.some(
      (worktree) =>
        worktree.processRunning ||
        worktree.health !== "not-running" ||
        worktree.setupState === "running"
    );
    if (topologyChanged && hasRunningProcesses) {
      throw new Error(
        "Stop repository apps and setup processes before changing app ports."
      );
    }
    updateWorkgroveConfig(workspace.configPath, config, revision);
  }

  environment(repoPath: string, slot: number): Record<string, string> {
    return commandEnvironment(this.config(repoPath), slot);
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

  logs(repoPath: string, id: string): string[] {
    this.worktree(repoPath, id);
    return readManagedLog(id);
  }
}
