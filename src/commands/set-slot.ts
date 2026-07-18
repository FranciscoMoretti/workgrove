import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { maximumWorkgroveAppGroupSlot } from "../config/workgrove-schema";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import {
  parseSlotAssignments,
  resolveSlotFilePath,
  slotAssignmentsContent,
} from "../runtime/slot-file";
import { requiredSlot, requiredString } from "./command";
import { findAppGroup, worktreeSlotAssignments } from "./start-apps";

export function setSlot(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const slot = requiredSlot(input.slot);
  const { workspace, worktree } = controller.worktree(repoPath, worktreeId);
  const appGroup = findAppGroup(worktree, appGroupName);
  if (
    appGroup.stop === "process" &&
    (appGroup.processRunning || appGroup.health !== "not-running")
  ) {
    throw new Error(`Stop ${appGroupName} before changing its slot`);
  }
  const configured = workspace.config.appGroups[appGroupName];
  if (!configured) {
    throw new Error(`Unknown App group "${appGroupName}"`);
  }
  if (slot > maximumWorkgroveAppGroupSlot(configured)) {
    throw new Error(`Slot ${slot} is outside the supported range`);
  }
  const file = resolveSlotFilePath(worktree.path, workspace.slotFile);
  const parsed = parseSlotAssignments(
    existsSync(file) ? readFileSync(file, "utf8") : ""
  );
  if (parsed.kind === "invalid") {
    throw new Error(`Repair or remove invalid local state at ${file}`);
  }
  const slots = {
    ...worktreeSlotAssignments(worktree),
    ...(parsed.kind === "value" ? parsed.slots : {}),
    [appGroupName]: slot,
  };
  const temporary = `${file}.workgrove-${process.pid}`;
  writeFileSync(temporary, slotAssignmentsContent(slots));
  renameSync(temporary, file);
  return {
    appGroupName,
    command: "set-slot",
    message: `Assigned ${appGroupName} slot ${slot}`,
    ok: true,
    worktreeId,
  };
}
