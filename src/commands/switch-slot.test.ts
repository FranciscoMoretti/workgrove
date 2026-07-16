import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceController } from "../controller/workspace-controller";
import {
  managedPid,
  startManagedProcess,
  stopManagedProcess,
} from "../runtime/process-supervisor";
import { switchSlot } from "./switch-slot";

const worktreeId = `switch-slot-test-${process.pid}`;
const SLOT_PATTERN = /WORKGROVE_SLOT=(\d+)/;
let root: string | null = null;

afterEach(async () => {
  if (root) {
    await stopManagedProcess(worktreeId, root);
    rmSync(root, { force: true, recursive: true });
    root = null;
  }
});

describe("switch slot command", () => {
  it("stops the app group, changes its slot, and starts it again", async () => {
    root = mkdtempSync(join(tmpdir(), "workgrove-switch-slot-"));
    const slotFile = ".env.worktree.local";
    const slotPath = join(root, slotFile);
    writeFileSync(slotPath, "WORKGROVE_SLOT=0\n");
    startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
      ],
      cwd: root,
      env: {},
      ownerRoot: root,
      worktreeId,
    });

    const controller = {
      assertTrusted: () => undefined,
      config: () => ({
        apps: { app: { basePort: 45_000 } },
        setup: { argv: ["true"] },
        start: {
          argv: [
            process.execPath,
            "-e",
            "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
          ],
        },
        stride: 10,
        version: 1,
      }),
      worktree: () => {
        const slot = Number(
          readFileSync(slotPath, "utf8").match(SLOT_PATTERN)?.[1]
        );
        return {
          workspace: {
            slotEnv: "WORKGROVE_SLOT",
            slotFile,
            slotOptions: [{ apps: [], collisionOwners: [], slot: 1 }],
            worktrees: [{ id: worktreeId, name: "worktree", slot }],
          },
          worktree: {
            apps: [],
            health: "not-running",
            id: worktreeId,
            path: root,
            processRunning: managedPid(worktreeId, root as string) !== null,
            slot,
            slotState: "assigned",
          },
        };
      },
    } as unknown as WorkspaceController;

    await switchSlot(controller, {
      repoPath: root,
      slot: 1,
      worktreeId,
    });

    expect(readFileSync(slotPath, "utf8")).toBe("WORKGROVE_SLOT=1\n");
    expect(managedPid(worktreeId, root)).not.toBeNull();
  });
});
