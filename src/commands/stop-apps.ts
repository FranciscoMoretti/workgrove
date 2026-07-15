import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { inspectListeningPorts, ownedPortPids } from "../runtime/ports";
import {
  appendManagedLog,
  stopManagedProcess,
} from "../runtime/process-supervisor";
import { requiredString } from "./command";

export function stopApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const { worktree } = controller.worktree(repoPath, worktreeId);
  const killed = new Set<number>();
  const managed = stopManagedProcess(worktreeId, worktree.path);
  if (managed) {
    killed.add(managed);
  }
  for (const pid of ownedPortPids(
    inspectListeningPorts(),
    worktree.apps.map((app) => app.port),
    worktree.path
  )) {
    try {
      process.kill(pid, "SIGTERM");
      killed.add(pid);
    } catch {
      // The process may have exited with its managed root.
    }
  }
  const message =
    killed.size === 0
      ? "No owned app processes were running"
      : `Stopped ${killed.size} owned process${killed.size === 1 ? "" : "es"}`;
  appendManagedLog(worktreeId, `[workgrove] ${message}`);
  return { command: "stop-apps", message, ok: true, worktreeId };
}
