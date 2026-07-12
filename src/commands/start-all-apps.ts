import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsAreStopped } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";
import { startApps } from "./start-apps";

export function startAllApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const targets = selectRequestedWorktrees(
    controller.inspect(repoPath).worktrees,
    input.worktreeIds
  ).filter(
    (worktree) => worktree.slotState === "assigned" && appsAreStopped(worktree)
  );
  for (const worktree of targets) {
    startApps(controller, { repoPath, worktreeId: worktree.id });
  }
  return {
    command: "start-all-apps",
    message: `Started apps in ${targets.length} worktree${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
