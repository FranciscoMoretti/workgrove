import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { resolveSetupCommand } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  appendManagedLog,
  setupProcessId,
  startManagedProcess,
} from "../runtime/process-supervisor";
import { requiredSlot, requiredString } from "./command";

const BRANCH_PATTERN = /^[A-Za-z0-9._/@-]+$/;
const FOLDER_PATTERN = /^[A-Za-z0-9._-]+$/;

import { setSlot } from "./set-slot";

function run(argv: string[], cwd: string, env = process.env): string {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `${command} failed`).trim()
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

export function createWorktree(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  controller.assertTrusted(repoPath);
  const branch = requiredString(input.branch, "Branch");
  const slot = requiredSlot(input.slot);
  const createBranch = input.createBranch !== false;
  if (branch.startsWith("-") || !BRANCH_PATTERN.test(branch)) {
    throw new Error("Branch contains unsupported characters");
  }
  const workspace = controller.inspect(repoPath);
  const occupied = workspace.worktrees.find(
    (worktree) => worktree.slot === slot
  );
  if (occupied) {
    throw new Error(`Slot ${slot} is already assigned to ${occupied.name}`);
  }
  const folderName =
    typeof input.folderName === "string" && input.folderName.trim()
      ? input.folderName.trim()
      : `${workspace.repoName}-${slot}`;
  if (!FOLDER_PATTERN.test(folderName)) {
    throw new Error(
      "Folder name can only contain letters, numbers, dot, underscore, and dash"
    );
  }
  const target = join(dirname(workspace.mainWorktreePath), folderName);
  if (existsSync(target)) {
    throw new Error(`Target path already exists: ${target}`);
  }
  const gitArgs = createBranch
    ? ["git", "worktree", "add", "-b", branch, target]
    : ["git", "worktree", "add", target, branch];
  run(gitArgs, workspace.mainWorktreePath);

  const created = controller
    .inspect(target)
    .worktrees.find(
      (worktree) =>
        worktree.path === target || basename(worktree.path) === folderName
    );
  if (!created) {
    throw new Error("Worktree was created but could not be rediscovered");
  }
  setSlot(controller, { repoPath: target, slot, worktreeId: created.id });
  const config = controller.config(target);
  const setup = resolveSetupCommand(config, slot);
  if (setup) {
    appendManagedLog(
      created.id,
      `[workgrove] Running setup: ${setup.argv.join(" ")}`
    );
    startManagedProcess({
      argv: setup.argv,
      cwd: setup.cwd ? join(target, setup.cwd) : target,
      env: setup.env,
      label: "Setup",
      logId: created.id,
      ownerId: created.id,
      ownerRoot: target,
      trackExitFailure: true,
      worktreeId: setupProcessId(created.id),
    });
  }
  return {
    command: "create-worktree",
    message: `Created ${folderName} on slot ${slot}${setup ? "; setup is running" : ""}`,
    ok: true,
    worktreeId: created.id,
  };
}
