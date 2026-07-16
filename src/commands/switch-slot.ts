import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsAreStopped,
} from "../controller/workspace-snapshot";
import { requiredSlot, requiredString } from "./command";
import { assertSlotTargetAvailable, setSlot } from "./set-slot";
import { startApps } from "./start-apps";
import { stopApps } from "./stop-apps";

const STOP_ATTEMPTS = 50;
const STOP_POLL_MS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function switchSlot(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const slot = requiredSlot(input.slot);
  controller.assertTrusted(repoPath);
  const current = controller.worktree(repoPath, worktreeId);
  if (!appsAreRunning(current.worktree)) {
    throw new Error("Apps must be running before switching their slot");
  }
  assertSlotTargetAvailable(current.workspace, worktreeId, slot);
  await stopApps(controller, { repoPath, worktreeId });
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    if (appsAreStopped(controller.worktree(repoPath, worktreeId).worktree)) {
      setSlot(controller, { repoPath, slot, worktreeId });
      const started = startApps(controller, { repoPath, worktreeId });
      return {
        ...started,
        command: "switch-slot",
        message: `Switched to slot ${slot} and restarted apps`,
      };
    }
    await delay(STOP_POLL_MS);
  }
  throw new Error("Apps did not stop within 5 seconds; slot switch cancelled");
}
