import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { pathInside, pidOwnedByWorktree } from "./ports";

const CONTROL_DIR = join(homedir(), ".workgrove");
const LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAK = /\r?\n$/;
interface ProcessRecord {
  argv: string[];
  cwd: string;
  label?: string;
  ownerId?: string;
  pid: number;
  startedAt: string;
  startMarker: string;
}

interface ProcessFailure {
  failedAt: string;
  message: string;
}

const processes = new Map<
  string,
  { child: ChildProcess; record: ProcessRecord }
>();

mkdirSync(CONTROL_DIR, { recursive: true });

function safeId(worktreeId: string): string {
  return worktreeId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function logPath(worktreeId: string): string {
  return join(CONTROL_DIR, `${safeId(worktreeId)}.log`);
}

function pidPath(worktreeId: string): string {
  return join(CONTROL_DIR, `${safeId(worktreeId)}.pid`);
}

function failurePath(worktreeId: string): string {
  return join(CONTROL_DIR, `${safeId(worktreeId)}.failure.json`);
}

function recordFailure(worktreeId: string, message: string): void {
  const failure: ProcessFailure = {
    failedAt: new Date().toISOString(),
    message,
  };
  writeFileSync(failurePath(worktreeId), `${JSON.stringify(failure)}\n`);
}

function live(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startMarker(pid: number): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function persistedRecord(worktreeId: string): ProcessRecord | null {
  const file = pidPath(worktreeId);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as ProcessRecord;
    return Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.cwd === "string" &&
      typeof value.startMarker === "string" &&
      value.startMarker.length > 0
      ? value
      : null;
  } catch {
    // Numeric files from older Workgrove versions are intentionally not trusted.
    return null;
  }
}

export function managedPid(
  worktreeId: string,
  expectedWorktreePath: string
): number | null {
  const tracked = processes.get(worktreeId);
  if (
    tracked?.child.pid &&
    pathInside(tracked.record.cwd, expectedWorktreePath) &&
    live(tracked.child.pid)
  ) {
    return tracked.child.pid;
  }
  const record = persistedRecord(worktreeId);
  if (
    !(
      record &&
      pathInside(record.cwd, expectedWorktreePath) &&
      live(record.pid) &&
      pidOwnedByWorktree(record.pid, expectedWorktreePath)
    ) ||
    startMarker(record.pid) !== record.startMarker
  ) {
    return null;
  }
  return record.pid;
}

export function startManagedProcess(input: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  logId?: string;
  label?: string;
  ownerId?: string;
  ownerRoot: string;
  trackExitFailure?: boolean;
  worktreeId: string;
}): number {
  if (!pathInside(input.cwd, input.ownerRoot)) {
    const message = "Command working directory must stay inside its worktree";
    if (input.trackExitFailure) {
      recordFailure(input.worktreeId, message);
    }
    throw new Error(message);
  }
  const existing = managedPid(input.worktreeId, input.cwd);
  if (existing) {
    throw new Error(`Apps are already managed by pid ${existing}`);
  }
  const [command, ...args] = input.argv;
  if (!command) {
    throw new Error("Start command requires at least one argv entry");
  }
  if (input.trackExitFailure) {
    rmSync(failurePath(input.worktreeId), { force: true });
  }
  const log = openSync(logPath(input.logId ?? input.worktreeId), "a");
  const child = (() => {
    try {
      return spawn(command, args, {
        cwd: input.cwd,
        detached: true,
        env: { ...process.env, ...input.env },
        stdio: ["ignore", log, log],
      });
    } finally {
      closeSync(log);
    }
  })();
  child.once("error", (error) => {
    appendManagedLog(
      input.logId ?? input.worktreeId,
      `[workgrove] Failed to start ${command}: ${error.message}`
    );
    if (input.trackExitFailure) {
      recordFailure(input.worktreeId, error.message);
    }
    if (processes.get(input.worktreeId)?.record.pid === child.pid) {
      processes.delete(input.worktreeId);
    }
    rmSync(pidPath(input.worktreeId), { force: true });
  });
  if (!child.pid) {
    throw new Error(`Failed to start ${command}`);
  }
  const record: ProcessRecord = {
    argv: input.argv,
    cwd: input.cwd,
    pid: child.pid,
    label: input.label,
    ownerId: input.ownerId ?? input.logId ?? input.worktreeId,
    startedAt: new Date().toISOString(),
    startMarker: startMarker(child.pid),
  };
  processes.set(input.worktreeId, { child, record });
  writeFileSync(pidPath(input.worktreeId), `${JSON.stringify(record)}\n`);
  child.once("exit", (code, signal) => {
    if (input.trackExitFailure) {
      if (code === 0) {
        rmSync(failurePath(input.worktreeId), { force: true });
      } else {
        recordFailure(
          input.worktreeId,
          signal
            ? `Exited after ${signal}`
            : `Exited with status ${code ?? "unknown"}`
        );
      }
    }
    if (processes.get(input.worktreeId)?.record.pid === child.pid) {
      processes.delete(input.worktreeId);
    }
  });
  child.unref();
  return child.pid;
}

export interface ManagedProcessSummary {
  argv: string[];
  cwd: string;
  label: string;
  ownerId: string;
  pid: number;
  startedAt: string;
}

export function listManagedProcesses(): ManagedProcessSummary[] {
  return readdirSync(CONTROL_DIR)
    .filter((name) => name.endsWith(".pid"))
    .flatMap((name) => {
      try {
        const record = JSON.parse(
          readFileSync(join(CONTROL_DIR, name), "utf8")
        ) as ProcessRecord;
        if (
          !live(record.pid) ||
          startMarker(record.pid) !== record.startMarker ||
          !pidOwnedByWorktree(record.pid, record.cwd)
        ) {
          return [];
        }
        return [
          {
            argv: record.argv,
            cwd: record.cwd,
            label: record.label ?? record.argv[0] ?? "Process",
            ownerId: record.ownerId ?? name.slice(0, -4),
            pid: record.pid,
            startedAt: record.startedAt,
          },
        ];
      } catch {
        return [];
      }
    });
}

export function setupProcessId(worktreeId: string): string {
  return `${worktreeId}--setup`;
}

export function managedFailure(worktreeId: string): ProcessFailure | null {
  try {
    return JSON.parse(
      readFileSync(failurePath(worktreeId), "utf8")
    ) as ProcessFailure;
  } catch {
    return null;
  }
}

export function stopManagedProcess(
  worktreeId: string,
  worktreePath: string
): number | null {
  const pid = managedPid(worktreeId, worktreePath);
  if (!pid) {
    return null;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  writeFileSync(pidPath(worktreeId), "");
  processes.delete(worktreeId);
  return pid;
}

export function appendManagedLog(worktreeId: string, message: string): void {
  const fd = openSync(logPath(worktreeId), "a");
  writeFileSync(fd, `${message}\n`);
  closeSync(fd);
}

export function readManagedLog(worktreeId: string, maxLines = 2000): string[] {
  const file = logPath(worktreeId);
  if (!existsSync(file)) {
    return [];
  }
  const content = readFileSync(file, "utf8").replace(TRAILING_LINE_BREAK, "");
  return content === "" ? [] : content.split(LINE_BREAK).slice(-maxLines);
}

export function clearManagedLog(worktreeId: string): void {
  writeFileSync(logPath(worktreeId), "");
}
