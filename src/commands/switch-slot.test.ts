import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceController } from "../controller/workspace-controller";
import {
  appGroupProcessId,
  managedPid,
  startManagedProcess,
  stopManagedProcess,
} from "../runtime/process-supervisor";
import { switchSlot } from "./switch-slot";

const worktreeId = `switch-slot-test-${process.pid}`;
let root: string | null = null;

afterEach(async () => {
  if (root) {
    await stopManagedProcess(appGroupProcessId(worktreeId, "Apps"), root);
    rmSync(root, { force: true, recursive: true });
    root = null;
  }
});

describe("switch slot command", () => {
  it("stops the app group, changes its slot, and starts it again", async () => {
    root = mkdtempSync(join(tmpdir(), "workgrove-switch-slot-"));
    const slotFile = ".workgrove.local.json";
    const slotPath = join(root, slotFile);
    writeFileSync(slotPath, '{"version":1,"slots":{"Apps":0}}\n');
    const processId = appGroupProcessId(worktreeId, "Apps");
    startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
      ],
      cwd: root,
      env: {},
      ownerRoot: root,
      worktreeId: processId,
      logId: processId,
    });

    const controller = {
      assertTrusted: () => undefined,
      config: () => ({
        appGroups: {
          Apps: {
            apps: { app: { basePort: 45_000 } },
            slot: { default: 0, stride: 10 },
            stop: "process",
            start: {
              argv: [
                process.execPath,
                "-e",
                "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
              ],
            },
          },
        },
        setup: { argv: ["true"] },
        version: 2,
      }),
      worktree: () => {
        const slot = JSON.parse(readFileSync(slotPath, "utf8")).slots
          .Apps as number;
        const processRunning = managedPid(processId, root as string) !== null;
        const appGroup = {
          apps: [],
          health: "not-running" as const,
          name: "Apps",
          processRunning,
          slot,
          slotState: "assigned" as const,
          stop: "process" as const,
        };
        return {
          workspace: {
            appGroupSlotOptions: {
              Apps: [{ apps: [], collisionOwners: [], slot: 1 }],
            },
            config: {
              appGroups: {
                Apps: {
                  apps: { app: { basePort: 45_000 } },
                  slot: { default: 0, stride: 10 },
                  start: { argv: ["true"] },
                  stop: "process",
                },
              },
              setup: { argv: ["true"] },
              version: 2,
            },
            slotFile,
            worktrees: [
              { id: worktreeId, name: "worktree", slot, appGroups: [appGroup] },
            ],
          },
          worktree: {
            apps: [],
            appGroups: [appGroup],
            health: "not-running",
            id: worktreeId,
            path: root,
            processRunning,
            slot,
            slotState: "assigned",
          },
        };
      },
    } as unknown as WorkspaceController;

    await switchSlot(controller, {
      appGroupName: "Apps",
      repoPath: root,
      slot: 1,
      worktreeId,
    });

    expect(JSON.parse(readFileSync(slotPath, "utf8")).slots.Apps).toBe(1);
    expect(managedPid(processId, root)).not.toBeNull();
  });
});
