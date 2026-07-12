import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  resolveSlotFilePath,
  updateSlotFileContent,
} from "../runtime/slot-file";
import { requiredSlot, requiredString } from "./command";

export function setSlot(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const slot = requiredSlot(input.slot);
  const { workspace, worktree } = controller.worktree(repoPath, worktreeId);
  const hasListener = worktree.apps.some(
    (app) => app.probe === "tcp" && app.ownership !== "none"
  );
  if (hasListener || worktree.processRunning) {
    throw new Error("Stop apps before changing the slot");
  }
  const occupied = workspace.worktrees.find(
    (item) => item.id !== worktreeId && item.slot === slot
  );
  if (occupied) {
    throw new Error(`Slot ${slot} is already assigned to ${occupied.name}`);
  }
  const option = workspace.slotOptions.find((item) => item.slot === slot);
  if (!option) {
    throw new Error(`Slot ${slot} is outside the supported range`);
  }
  const file = resolveSlotFilePath(worktree.path, workspace.slotFile);
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const temporary = `${file}.workgrove-${process.pid}`;
  writeFileSync(
    temporary,
    updateSlotFileContent(content, workspace.slotEnv, slot)
  );
  renameSync(temporary, file);
  return {
    command: "set-slot",
    message: `Assigned slot ${slot}`,
    ok: true,
    worktreeId,
  };
}
