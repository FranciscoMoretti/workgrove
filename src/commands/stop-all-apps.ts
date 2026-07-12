import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsAreRunning } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";
import { stopApps } from "./stop-apps";

export function stopAllApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const workspace = controller.inspect(repoPath);
  const running = selectRequestedWorktrees(
    workspace.worktrees,
    input.worktreeIds
  ).filter(appsAreRunning);
  for (const worktree of running) {
    stopApps(controller, { repoPath, worktreeId: worktree.id });
  }
  return {
    command: "stop-all-apps",
    message: `Stopped apps in ${running.length} worktree${running.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
