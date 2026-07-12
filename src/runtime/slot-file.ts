import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAK = /\r?\n$/;

export type ParsedSlot =
  | { kind: "invalid"; raw: string }
  | { kind: "missing" }
  | { kind: "value"; slot: number };

export function parseSlotFromContent(
  content: string,
  envName: string
): ParsedSlot {
  for (const line of content.split(LINE_BREAK)) {
    const match = ENV_LINE.exec(line);
    if (match?.[1] !== envName) {
      continue;
    }
    const slot = Number(match[2]);
    return Number.isSafeInteger(slot) && slot >= 0
      ? { kind: "value", slot }
      : { kind: "invalid", raw: match[2] };
  }
  return { kind: "missing" };
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

export function updateSlotFileContent(
  content: string,
  envName: string,
  slot: number
): string {
  const lines =
    content === ""
      ? []
      : content.replace(TRAILING_LINE_BREAK, "").split(LINE_BREAK);
  let replaced = false;
  const updated = lines.map((line) => {
    const match = ENV_LINE.exec(line);
    if (match?.[1] !== envName) {
      return line;
    }
    replaced = true;
    return `${envName}=${slot}`;
  });

  if (!replaced) {
    updated.push(`${envName}=${slot}`);
  }
  return `${updated.join("\n")}\n`;
}
