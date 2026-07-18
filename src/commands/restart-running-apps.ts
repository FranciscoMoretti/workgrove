import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appGroupCanRestart } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";
import { restartApps } from "./restart-apps";

export async function restartRunningApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const requestedGroup =
    typeof input.appGroupName === "string" ? input.appGroupName : null;
  const worktrees = selectRequestedWorktrees(
    controller.inspect(repoPath).worktrees,
    input.worktreeIds
  );
  const seenCommandInstances = new Set<string>();
  const targets = worktrees.flatMap((worktree) =>
    worktree.appGroups.flatMap((group) => {
      if (
        (requestedGroup && group.name !== requestedGroup) ||
        !appGroupCanRestart(group)
      ) {
        return [];
      }
      if (group.stop === "command") {
        const instance = `${group.name}\0${group.slot}`;
        if (seenCommandInstances.has(instance)) {
          return [];
        }
        seenCommandInstances.add(instance);
      }
      return [{ appGroupName: group.name, worktreeId: worktree.id }];
    })
  );
  for (const target of targets) {
    await restartApps(controller, { repoPath, ...target });
  }
  return {
    command: "restart-running-apps",
    message: `Restarted ${targets.length} App group${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
