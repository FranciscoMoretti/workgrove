import { describe, expect, it } from "bun:test";

import type { WorkspaceController } from "../controller/workspace-controller";
import { createWorktree } from "./create-worktree";
import { setSlot } from "./set-slot";

const collisionOwners = [
  { id: "moving-id", name: "moving" },
  { id: "blocking-id", name: "blocking" },
];

describe("slot collision command enforcement", () => {
  it("rejects a new worktree when any assigned worktree blocks its slot", () => {
    const controller = {
      assertTrusted: () => undefined,
      inspect: () => ({
        mainWorktreePath: "/repo",
        repoName: "repo",
        slotOptions: [{ apps: [], collisionOwners, slot: 500 }],
      }),
    } as unknown as WorkspaceController;

    expect(() =>
      createWorktree(controller, {
        branch: "feature",
        repoPath: "/repo",
        slot: 500,
      })
    ).toThrow("port collision with moving");
  });

  it("does not let the moving worktree mask another collision owner", () => {
    const controller = {
      worktree: () => ({
        workspace: {
          slotEnv: "WORKGROVE_SLOT",
          slotFile: ".env.worktree.local",
          slotOptions: [{ apps: [], collisionOwners, slot: 500 }],
          worktrees: [],
        },
        worktree: {
          apps: [],
          id: "moving-id",
          path: "/repo",
          processRunning: false,
        },
      }),
    } as unknown as WorkspaceController;

    expect(() =>
      setSlot(controller, {
        repoPath: "/repo",
        slot: 500,
        worktreeId: "moving-id",
      })
    ).toThrow("port collision with blocking");
  });
});
