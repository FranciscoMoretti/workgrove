import { resolveStartCommand } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { startManagedProcess } from "../runtime/process-supervisor";
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
  const command = resolveStartCommand(config, worktree.slot);
  if (!command) {
    throw new Error("No start command is configured in .workgrove.json");
  }
  startManagedProcess({
    argv: command.argv,
    cwd: worktree.path,
    env: command.env,
    logId: worktreeId,
    label: "Apps",
    ownerId: worktreeId,
    ownerRoot: worktree.path,
    worktreeId,
  });
  return {
    command: "start-apps",
    message: "Started apps",
    ok: true,
    worktreeId,
  };
}
