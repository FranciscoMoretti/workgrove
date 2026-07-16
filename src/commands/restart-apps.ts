import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsAreRunning } from "../controller/workspace-snapshot";
import { requiredString } from "./command";
import { startApps } from "./start-apps";
import { stopAppsAndWait } from "./stop-apps-and-wait";

export async function restartApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const current = controller.worktree(repoPath, worktreeId).worktree;
  if (!appsAreRunning(current)) {
    throw new Error("Apps must be running before they can be restarted");
  }
  if (current.slotState !== "assigned") {
    throw new Error("Assign a unique slot before restarting apps");
  }
  await stopAppsAndWait(
    controller,
    { repoPath, worktreeId },
    "Apps did not stop within 5 seconds; restart was cancelled"
  );
  const started = startApps(controller, { repoPath, worktreeId });
  return {
    ...started,
    command: "restart-apps",
    message: started.message.replace("Started", "Restarted"),
  };
}
