import { describe, expect, it } from "bun:test";

import { WorkspaceSnapshotSchema } from "./schemas";

describe("workspace snapshot transport schema", () => {
  it("preserves the slot collision owner identity", () => {
    const snapshot = WorkspaceSnapshotSchema.parse({
      config: {
        version: 1,
        stride: 10,
        apps: { web: { basePort: 3000 } },
      },
      configPath: "/repo/.workgrove.json",
      configRevision: "revision",
      defaultSlot: 0,
      globalProcesses: [],
      globalRunningCount: 0,
      mainWorktreePath: "/repo",
      repoName: "repo",
      repoPath: "/repo",
      setupAvailable: false,
      slotEnv: "WORKGROVE_SLOT",
      slotFile: ".env.worktree.local",
      slotOptions: [
        {
          apps: [{ label: "Web", port: 3000 }],
          collisionOwners: [{ id: "main-id", name: "main" }],
          slot: 0,
        },
      ],
      trustCommands: [],
      trustRequired: false,
      trusted: true,
      updatedAt: "2026-07-14T00:00:00.000Z",
      worktrees: [],
    });

    expect(snapshot.slotOptions[0]?.collisionOwners).toEqual([
      { id: "main-id", name: "main" },
    ]);
  });
});
