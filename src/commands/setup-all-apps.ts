import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appsAreStopped } from "../controller/workspace-snapshot";
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
  if (!config.control?.postCreate) {
    throw new Error("Missing control.postCreate argv in .workgrove.json");
  }
  const targets = selectRequestedWorktrees(
    workspace.worktrees,
    input.worktreeIds
  ).filter(appsAreStopped);
  for (const worktree of targets) {
    const slot = worktree.slot ?? config.slot.default;
    const setup = resolvePostCreateCommand(config, slot);
    if (!setup) {
      continue;
    }
    appendManagedLog(
      worktree.id,
      `[workgrove] Running setup: ${setup.argv.join(" ")}`
    );
    startManagedProcess({
      argv: setup.argv,
      cwd: setup.cwd ? resolve(worktree.path, setup.cwd) : worktree.path,
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

import { resolve } from "node:path";

import { resolvePostCreateCommand } from "../config/workgrove-config";
