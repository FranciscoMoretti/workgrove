import { resolveStartCommand } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type {
  AppGroupSnapshot,
  CommandReceipt,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import {
  appGroupProcessId,
  runFiniteCommand,
  startManagedProcess,
} from "../runtime/process-supervisor";
import { requiredString } from "./command";

export function findAppGroup(
  worktree: WorktreeSnapshot,
  appGroupName: string
): AppGroupSnapshot {
  const group = worktree.appGroups.find((item) => item.name === appGroupName);
  if (!group) {
    throw new Error(`Unknown App group "${appGroupName}"`);
  }
  return group;
}

export function worktreeSlotAssignments(
  worktree: WorktreeSnapshot
): Record<string, number> {
  return Object.fromEntries(
    worktree.appGroups.map((group) => [group.name, group.slot])
  );
}

export async function startApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  controller.assertTrusted(repoPath);
  const { worktree } = controller.worktree(repoPath, worktreeId);
  const appGroup = findAppGroup(worktree, appGroupName);
  if (appGroup.slotState !== "assigned") {
    throw new Error(`Choose a valid slot before starting ${appGroupName}`);
  }
  if (appGroup.health === "running" || appGroup.processRunning) {
    return {
      appGroupName,
      command: "start-apps",
      message: `${appGroupName} is already running`,
      ok: true,
      worktreeId,
    };
  }
  if (appGroup.stop === "process") {
    const occupied = appGroup.apps.filter((app) => app.ownership === "foreign");
    if (occupied.length > 0) {
      throw new Error(
        `Slot ${appGroup.slot} is in use on ports ${occupied
          .map((app) => app.port)
          .join(", ")}`
      );
    }
  }
  const config = controller.config(repoPath);
  const command = resolveStartCommand(
    config,
    appGroupName,
    worktreeSlotAssignments(worktree)
  );
  const processId = appGroupProcessId(worktreeId, appGroupName);
  if (appGroup.stop === "process") {
    startManagedProcess({
      argv: command.argv,
      cwd: worktree.path,
      env: command.env,
      logId: processId,
      label: appGroupName,
      ownerId: processId,
      ownerRoot: worktree.path,
      worktreeId: processId,
    });
  } else {
    await runFiniteCommand({
      argv: command.argv,
      cwd: worktree.path,
      env: command.env,
      label: `Start ${appGroupName}`,
      logId: processId,
    });
  }
  return {
    appGroupName,
    command: "start-apps",
    message: `Started ${appGroupName}`,
    ok: true,
    worktreeId,
  };
}
