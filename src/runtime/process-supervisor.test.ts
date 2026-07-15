import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import {
  appendManagedLog,
  clearManagedLog,
  logPath,
  managedPid,
  readManagedLog,
  startManagedProcess,
  stopManagedProcess,
} from "./process-supervisor";

const worktreeId = `clear-log-test-${process.pid}`;
const stopTestId = `app-group-stop-test-${process.pid}`;

afterEach(() => {
  rmSync(logPath(worktreeId), { force: true });
  rmSync(logPath(stopTestId), { force: true });
});

describe("managed logs", () => {
  it("returns no phantom line after the terminal is cleared", () => {
    appendManagedLog(worktreeId, "before clear");
    expect(readManagedLog(worktreeId)).toEqual(["before clear"]);
    clearManagedLog(worktreeId);
    expect(readManagedLog(worktreeId)).toEqual([]);
  });

  it("contains and logs an executable spawn failure", async () => {
    expect(() =>
      startManagedProcess({
        argv: [`missing-workgrove-command-${process.pid}`],
        cwd: process.cwd(),
        env: {},
        ownerRoot: process.cwd(),
        worktreeId,
      })
    ).toThrow("Failed to start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readManagedLog(worktreeId).join("\n")).toContain("Failed to start");
  });

  it("rejects a configured working directory outside the worktree", () => {
    expect(() =>
      startManagedProcess({
        argv: ["true"],
        cwd: "/tmp",
        env: {},
        ownerRoot: "/code/worktree",
        worktreeId,
      })
    ).toThrow("must stay inside its worktree");
  });

  it("keeps a terminating app group managed until its process exits", async () => {
    const pid = startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        'console.log("ready"); process.on("SIGTERM", () => setTimeout(() => process.exit(0), 200)); setInterval(() => {}, 1000);',
      ],
      cwd: process.cwd(),
      env: {},
      ownerRoot: process.cwd(),
      worktreeId: stopTestId,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (readManagedLog(stopTestId).includes("ready")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(stopManagedProcess(stopTestId, process.cwd())).toBe(pid);
    expect(managedPid(stopTestId, process.cwd())).toBe(pid);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(managedPid(stopTestId, process.cwd())).toBeNull();
  });
});
