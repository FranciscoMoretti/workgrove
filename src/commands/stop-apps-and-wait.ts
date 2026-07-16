import type { WorkspaceController } from "../controller/workspace-controller";
import { appsAreStopped } from "../controller/workspace-snapshot";
import { stopApps } from "./stop-apps";

const STOP_ATTEMPTS = 50;
const STOP_POLL_MS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function stopAppsAndWait(
  controller: WorkspaceController,
  input: { repoPath: string; worktreeId: string },
  timeoutMessage: string
): Promise<void> {
  await stopApps(controller, input);
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    if (
      appsAreStopped(
        controller.worktree(input.repoPath, input.worktreeId).worktree
      )
    ) {
      return;
    }
    await delay(STOP_POLL_MS);
  }
  throw new Error(timeoutMessage);
}
