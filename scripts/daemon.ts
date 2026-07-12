#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentHost } from "../src/host/host-adapter";
import {
  repositoryPathFromArgs,
  repositoryUrl,
} from "../src/repository-context";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTROL_DIR = join(homedir(), ".workgrove");
const LEGACY_CONTROL_DIR = join(homedir(), ".trellis");
const PID_FILE = join(CONTROL_DIR, "server.pid");
const LEGACY_PID_FILE = join(LEGACY_CONTROL_DIR, "server.pid");
const LOG_FILE = join(CONTROL_DIR, "server.log");
const command = process.argv[2];
const selectedRepoPath = repositoryPathFromArgs(
  process.argv.slice(3),
  process.env.INIT_CWD
);
const repoPath = selectedRepoPath ? resolve(selectedRepoPath) : null;

function appUrl(): string {
  return repositoryUrl(
    `http://127.0.0.1:${process.env.WORKGROVE_PORT ?? 3999}/`,
    repoPath
  );
}

function openApp(): void {
  if (process.env.WORKGROVE_NO_OPEN === "1") {
    return;
  }
  currentHost().openUrl(appUrl());
}

interface DaemonRecord {
  pid: number;
  startMarker: string;
}

function startMarker(pid: number): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readPid(file = PID_FILE): number | null {
  if (!existsSync(file)) {
    return null;
  }
  try {
    const record = JSON.parse(readFileSync(file, "utf8")) as DaemonRecord;
    return Number.isInteger(record.pid) &&
      record.pid > 0 &&
      record.startMarker.length > 0 &&
      startMarker(record.pid) === record.startMarker
      ? record.pid
      : null;
  } catch {
    return null;
  }
}

async function migrateLegacyState(): Promise<void> {
  if (!existsSync(LEGACY_CONTROL_DIR)) {
    mkdirSync(CONTROL_DIR, { recursive: true });
    return;
  }
  const legacyPid = readPid(LEGACY_PID_FILE);
  if (legacyPid && alive(legacyPid)) {
    process.kill(legacyPid, "SIGTERM");
    for (let attempt = 0; attempt < 40 && alive(legacyPid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (alive(legacyPid)) {
      throw new Error("Could not stop the legacy daemon during migration");
    }
  }
  rmSync(LEGACY_PID_FILE, { force: true });
  mkdirSync(CONTROL_DIR, { recursive: true });
  for (const entry of readdirSync(LEGACY_CONTROL_DIR)) {
    const source = join(LEGACY_CONTROL_DIR, entry);
    const destination = join(CONTROL_DIR, entry);
    if (!existsSync(destination)) {
      renameSync(source, destination);
    }
  }
  try {
    rmSync(LEGACY_CONTROL_DIR);
  } catch {
    // Conflicting files remain available for manual inspection.
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(expectedPid: number): Promise<void> {
  const url = `http://127.0.0.1:${process.env.WORKGROVE_PORT ?? 3999}/api/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = (await response.json()) as {
        pid?: number;
        service?: string;
      };
      if (
        response.ok &&
        body.service === "workgrove" &&
        body.pid === expectedPid
      ) {
        return;
      }
    } catch {
      // The detached server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Workgrove did not become healthy; inspect ${LOG_FILE}`);
}

async function start(): Promise<void> {
  await migrateLegacyState();
  const existing = readPid();
  if (existing && alive(existing)) {
    openApp();
    console.log(`Workgrove is already running (pid ${existing}): ${appUrl()}`);
    return;
  }
  rmSync(PID_FILE, { force: true });
  const log = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, ["run", "src/server/server.ts"], {
    cwd: APP_ROOT,
    detached: true,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  if (!child.pid) {
    throw new Error("Failed to start Workgrove");
  }
  child.unref();
  writeFileSync(
    PID_FILE,
    `${JSON.stringify({ pid: child.pid, startMarker: startMarker(child.pid) })}\n`
  );
  await waitForHealth(child.pid);
  openApp();
  console.log(`Workgrove started: ${appUrl()}`);
}

function status(): void {
  const pid = readPid();
  if (pid && alive(pid)) {
    console.log(`Workgrove is running (pid ${pid})`);
    return;
  }
  const legacyPid = readPid(LEGACY_PID_FILE);
  if (legacyPid && alive(legacyPid)) {
    console.log(`Workgrove is running (legacy daemon pid ${legacyPid})`);
    return;
  }
  console.log("Workgrove is stopped");
  process.exitCode = 1;
}

function stop(): void {
  const pids = new Set(
    [readPid(), readPid(LEGACY_PID_FILE)].filter(
      (pid): pid is number => pid !== null && alive(pid)
    )
  );
  if (pids.size === 0) {
    rmSync(PID_FILE, { force: true });
    rmSync(LEGACY_PID_FILE, { force: true });
    console.log("Workgrove is already stopped");
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The daemon may have exited after the liveness check.
    }
  }
  rmSync(PID_FILE, { force: true });
  rmSync(LEGACY_PID_FILE, { force: true });
  console.log("Workgrove stopped");
}

if (command === "start") {
  await start();
} else if (command === "status") {
  status();
} else if (command === "stop") {
  stop();
} else {
  throw new Error("Usage: daemon <start|status|stop> [--repo PATH]");
}
