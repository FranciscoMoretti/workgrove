import {
  configuredSetupCommand,
  resolveSetupCommand,
} from "../config/workgrove-config";
import { WORKGROVE_DEFAULT_SLOT } from "../config/workgrove-schema";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appendManagedLog,
  setupProcessId,
  startManagedProcess,
} from "../runtime/process-supervisor";
import { requiredString, selectRequestedWorktrees } from "./command";

export function setupAllApps(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  controller.assertTrusted(repoPath);
  const workspace = controller.inspect(repoPath);
  const config = controller.config(repoPath);
  if (!configuredSetupCommand(config)) {
    throw new Error("Missing setup command in .workgrove.json");
  }
  const targets = selectRequestedWorktrees(
    workspace.worktrees,
    input.worktreeIds
  );
  for (const worktree of targets) {
    const slot = worktree.slot ?? WORKGROVE_DEFAULT_SLOT;
    const setup = resolveSetupCommand(config, slot);
    if (!setup) {
      continue;
    }
    appendManagedLog(
      worktree.id,
      `[workgrove] Running setup: ${setup.argv.join(" ")}`
    );
    startManagedProcess({
      argv: setup.argv,
      cwd: worktree.path,
      env: setup.env,
      label: "Setup",
      logId: worktree.id,
      ownerId: worktree.id,
      ownerRoot: worktree.path,
      trackExitFailure: true,
      worktreeId: setupProcessId(worktree.id),
    });
  }
  return {
    command: "setup-all-apps",
    message: `Started setup in ${targets.length} worktree${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
}
