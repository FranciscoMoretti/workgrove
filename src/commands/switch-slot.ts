import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appGroupIsRunning } from "../controller/workspace-snapshot";
import { requiredSlot, requiredString } from "./command";
import { setSlot } from "./set-slot";
import { findAppGroup, startApps } from "./start-apps";
import { stopAppsAndWait } from "./stop-apps-and-wait";

export async function switchSlot(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const slot = requiredSlot(input.slot);
  controller.assertTrusted(repoPath);
  const current = controller.worktree(repoPath, worktreeId);
  const group = findAppGroup(current.worktree, appGroupName);
  if (group.stop !== "process") {
    return setSlot(controller, { appGroupName, repoPath, slot, worktreeId });
  }
  if (!appGroupIsRunning(group)) {
    throw new Error(
      `${appGroupName} must be running before switching its slot`
    );
  }
  await stopAppsAndWait(
    controller,
    { appGroupName, repoPath, worktreeId },
    `${appGroupName} did not stop within 5 seconds; slot switch cancelled`
  );
  setSlot(controller, { appGroupName, repoPath, slot, worktreeId });
  const started = await startApps(controller, {
    appGroupName,
    repoPath,
    worktreeId,
  });
  return {
    ...started,
    command: "switch-slot",
    message: `Switched ${appGroupName} to slot ${slot} and restarted it`,
  };
}
