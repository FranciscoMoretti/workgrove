import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsCanRestart } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";
import { restartApps } from "./restart-apps";

export async function restartRunningApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const targets = selectRequestedWorktrees(
    controller.inspect(repoPath).worktrees,
    input.worktreeIds
  ).filter(appsCanRestart);
  for (const worktree of targets) {
    await restartApps(controller, { repoPath, worktreeId: worktree.id });
  }
  return {
    command: "restart-running-apps",
    message: `Restarted apps in ${targets.length} worktree${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
