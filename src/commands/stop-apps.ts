import { resolveStopCommand } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { inspectListeningPorts, ownedPortPids } from "../runtime/ports";
import {
  appendManagedLog,
  appGroupProcessId,
  runFiniteCommand,
  stopManagedProcess,
  stopOwnedProcess,
} from "../runtime/process-supervisor";
import { requiredString } from "./command";
import { findAppGroup, worktreeSlotAssignments } from "./start-apps";

export async function stopApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const { worktree } = controller.worktree(repoPath, worktreeId);
  const appGroup = findAppGroup(worktree, appGroupName);
  const processId = appGroupProcessId(worktreeId, appGroupName);

  if (appGroup.stop === "command") {
    controller.assertTrusted(repoPath);
    const command = resolveStopCommand(
      controller.config(repoPath),
      appGroupName,
      worktreeSlotAssignments(worktree)
    );
    if (!command) {
      throw new Error(`${appGroupName} does not configure a Stop command`);
    }
    if (appGroup.health === "not-running") {
      return {
        appGroupName,
        command: "stop-apps",
        message: `${appGroupName} is already stopped`,
        ok: true,
        worktreeId,
      };
    }
    await runFiniteCommand({
      argv: command.argv,
      cwd: worktree.path,
      env: command.env,
      label: `Stop ${appGroupName}`,
      logId: processId,
    });
    return {
      appGroupName,
      command: "stop-apps",
      message: `Stopped ${appGroupName}`,
      ok: true,
      worktreeId,
    };
  }

  const killed = new Set<number>();
  const managed = await stopManagedProcess(processId, worktree.path);
  if (managed) {
    killed.add(managed);
  }
  for (const pid of ownedPortPids(
    inspectListeningPorts(),
    appGroup.apps.map((app) => app.port),
    worktree.path
  )) {
    if (await stopOwnedProcess(pid, processId)) {
      killed.add(pid);
    }
  }
  const message =
    killed.size === 0
      ? `No owned ${appGroupName} processes were running`
      : `Stopped ${appGroupName}`;
  appendManagedLog(processId, `[workgrove] ${message}`);
  return {
    appGroupName,
    command: "stop-apps",
    message,
    ok: true,
    worktreeId,
  };
}
