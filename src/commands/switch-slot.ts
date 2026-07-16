import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsAreRunning } from "../controller/workspace-snapshot";
import { requiredSlot, requiredString } from "./command";
import { assertSlotTargetAvailable, setSlot } from "./set-slot";
import { startApps } from "./start-apps";
import { stopAppsAndWait } from "./stop-apps-and-wait";

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
  await stopAppsAndWait(
    controller,
    { repoPath, worktreeId },
    "Apps did not stop within 5 seconds; slot switch cancelled"
  );
  setSlot(controller, { repoPath, slot, worktreeId });
  const started = startApps(controller, { repoPath, worktreeId });
  return {
    ...started,
    command: "switch-slot",
    message: `Switched to slot ${slot} and restarted apps`,
  };
}
