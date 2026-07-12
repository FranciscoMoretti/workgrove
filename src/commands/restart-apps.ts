import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsAreStopped,
} from "../controller/workspace-snapshot";
import { requiredString } from "./command";
import { startApps } from "./start-apps";
import { stopApps } from "./stop-apps";

const STOP_ATTEMPTS = 50;
const STOP_POLL_MS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  stopApps(controller, { repoPath, worktreeId });
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    const worktree = controller.worktree(repoPath, worktreeId).worktree;
    if (appsAreStopped(worktree)) {
      const started = startApps(controller, { repoPath, worktreeId });
      return {
        ...started,
        command: "restart-apps",
        message: started.message.replace("Started", "Restarted"),
      };
    }
    await delay(STOP_POLL_MS);
  }
  throw new Error("Apps did not stop within 5 seconds; restart was cancelled");
}
