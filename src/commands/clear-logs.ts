import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appGroupProcessId,
  clearManagedLog,
} from "../runtime/process-supervisor";
import { requiredString } from "./command";

export function clearLogs(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  controller.worktree(repoPath, worktreeId);
  clearManagedLog(appGroupProcessId(worktreeId, appGroupName));
  return {
    appGroupName,
    command: "clear-logs",
    message: `Cleared ${appGroupName} terminal`,
    ok: true,
    worktreeId,
  };
}
