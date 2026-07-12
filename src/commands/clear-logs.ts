import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { clearManagedLog } from "../runtime/process-supervisor";
import { requiredString } from "./command";

export function clearLogs(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  controller.worktree(repoPath, worktreeId);
  clearManagedLog(worktreeId);
  return {
    command: "clear-logs",
    message: "Cleared managed terminal",
    ok: true,
    worktreeId,
  };
}
