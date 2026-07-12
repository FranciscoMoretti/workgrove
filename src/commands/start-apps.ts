import { resolve } from "node:path";

import { resolveStartCommands } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appProcessId,
  startManagedProcess,
  stopManagedProcess,
} from "../runtime/process-supervisor";
import { requiredString } from "./command";

export function startApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  controller.assertTrusted(repoPath);
  const { worktree } = controller.worktree(repoPath, worktreeId);
  if (worktree.slot === null || worktree.slotState !== "assigned") {
    throw new Error("Assign a unique slot before starting apps");
  }
  if (worktree.health === "running") {
    return {
      command: "start-apps",
      message: "Apps are already running",
      ok: true,
      worktreeId,
    };
  }
  const config = controller.config(repoPath);
  const occupied = worktree.apps.filter((app) => app.ownership === "foreign");
  if (occupied.length > 0) {
    throw new Error(
      `Ports already used by another worktree or repository: ${occupied.map((app) => app.port).join(", ")}`
    );
  }
  const commands = resolveStartCommands(config, worktree.slot);
  if (commands.length === 0) {
    throw new Error("No app start commands are configured in .workgrove.json");
  }
  const started: Array<{ id: string; pid: number }> = [];
  try {
    for (const command of commands) {
      const id = command.appId
        ? appProcessId(worktreeId, command.appId)
        : worktreeId;
      const pid = startManagedProcess({
        argv: command.argv,
        cwd: command.cwd ? resolve(worktree.path, command.cwd) : worktree.path,
        env: command.env,
        logId: worktreeId,
        label: command.appId
          ? (config.apps[command.appId]?.control?.label ?? command.appId)
          : "Apps",
        ownerId: worktreeId,
        ownerRoot: worktree.path,
        worktreeId: id,
      });
      started.push({ id, pid });
    }
  } catch (error) {
    for (const process of started) {
      stopManagedProcess(process.id, worktree.path);
    }
    throw error;
  }
  return {
    command: "start-apps",
    message: `Started ${started.length} app process${started.length === 1 ? "" : "es"}`,
    ok: true,
    worktreeId,
  };
}
