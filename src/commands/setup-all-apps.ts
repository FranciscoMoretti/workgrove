import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";

export function setupAllApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  controller.assertTrusted(repoPath);
  const workspace = controller.inspect(repoPath);
  const targets = selectRequestedWorktrees(
    workspace.worktrees,
    input.worktreeIds
  );
  for (const worktree of targets) {
    controller.startSetup(repoPath, worktree.id);
  }
  return {
    command: "setup-all-apps",
    message: `Started setup in ${targets.length} worktree${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
