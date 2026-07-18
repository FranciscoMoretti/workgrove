import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const LEGACY_SLOT_PATTERN = /^WORKGROVE_SLOT=(.*)$/m;

export interface WorkgroveLocalState {
  slots: Record<string, number>;
  version: 1;
}

export type ParsedSlotAssignments =
  | { kind: "invalid"; raw: string }
  | { kind: "missing"; slots: Record<string, never> }
  | { kind: "value"; slots: Record<string, number> };

export function parseSlotAssignments(content: string): ParsedSlotAssignments {
  if (content.trim() === "") {
    return { kind: "missing", slots: {} };
  }
  try {
    const value = JSON.parse(content) as Partial<WorkgroveLocalState>;
    if (!(value && value.version === 1 && value.slots)) {
      return { kind: "invalid", raw: content };
    }
    for (const [name, slot] of Object.entries(value.slots)) {
      if (!(name && Number.isSafeInteger(slot) && slot >= 0)) {
        return { kind: "invalid", raw: content };
      }
    }
    return { kind: "value", slots: value.slots };
  } catch {
    return { kind: "invalid", raw: content };
  }
}

export function slotAssignmentsContent(slots: Record<string, number>): string {
  return `${JSON.stringify({ version: 1, slots } satisfies WorkgroveLocalState, null, 2)}\n`;
}

export function parseLegacySlot(content: string): number | null {
  const match = content.match(LEGACY_SLOT_PATTERN);
  if (!match) {
    return null;
  }
  const slot = Number(match[1]);
  return Number.isSafeInteger(slot) && slot >= 0 ? slot : null;
}

export function resolveSlotFilePath(
  worktreeRoot: string,
  relativeFile: string
): string {
  if (!relativeFile || isAbsolute(relativeFile)) {
    throw new Error("Slot file must be a relative path inside the worktree");
  }
  const root = realpathSync(worktreeRoot);
  const target = resolve(root, relativeFile);
  const candidate = relative(root, target);
  if (
    candidate === "" ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`) ||
    isAbsolute(candidate)
  ) {
    throw new Error("Slot file must stay inside the worktree");
  }
  let current = root;
  for (const part of candidate.split(sep)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("Refusing to use a symlinked slot file path");
    }
  }
  return target;
}
