import { describe, expect, it } from "bun:test";

import { CodexIntegrationSnapshotSchema } from "../codex/codex-integration";
import { WorkspaceSnapshotSchema } from "./schemas";

describe("workspace snapshot transport schema", () => {
  it("preserves exact App group names and independent slot options", () => {
    const group = {
      slot: { default: 0, stride: 10 },
      start: { argv: ["npm", "run", "dev"] },
      stop: "process" as const,
      apps: { Web: { basePort: 3000 } },
    };
    const option = {
      apps: [{ label: "Web", port: 3000 }],
      collisionOwners: [],
      slot: 0,
    };
    const snapshot = WorkspaceSnapshotSchema.parse({
      appGroupSlotOptions: { "Product Apps": [option] },
      config: {
        version: 2,
        setup: { argv: ["npm", "install"] },
        appGroups: { "Product Apps": group },
      },
      configPath: "/repo/.workgrove.json",
      configRevision: "revision",
      defaultSlot: 0,
      globalProcesses: [],
      globalRunningCount: 0,
      mainWorktreePath: "/repo",
      primaryAppGroup: "Product Apps",
      repoName: "repo",
      repoPath: "/repo",
      slotFile: ".workgrove.local.json",
      slotOptions: [option],
      trustCommands: [],
      trustRequired: true,
      trusted: true,
      updatedAt: "2026-07-14T00:00:00.000Z",
      worktrees: [],
    });
    expect(snapshot.appGroupSlotOptions["Product Apps"][0]?.slot).toBe(0);
  });
});

describe("Codex integration transport schema", () => {
  it("preserves only the agreed task metadata and activity", () => {
    const snapshot = CodexIntegrationSnapshotSchema.parse({
      updatedAt: "2026-07-18T13:00:00.000Z",
      worktrees: {
        worktree: {
          tasks: [
            {
              activity: {
                observedAt: "2026-07-18T12:30:00.000Z",
                state: "waiting-for-approval",
                subagentCount: 1,
              },
              contextSharedAt: "2026-07-18T12:00:00.000Z",
              createdAt: "2026-07-17T10:00:00.000Z",
              id: "task-a",
              preview: "must not cross the transport seam",
              title: "Task A",
              updatedAt: "2026-07-18T12:15:00.000Z",
            },
          ],
        },
      },
    });

    expect(snapshot.worktrees.worktree.tasks[0]).toEqual({
      activity: {
        observedAt: "2026-07-18T12:30:00.000Z",
        state: "waiting-for-approval",
        subagentCount: 1,
      },
      contextSharedAt: "2026-07-18T12:00:00.000Z",
      createdAt: "2026-07-17T10:00:00.000Z",
      id: "task-a",
      title: "Task A",
      updatedAt: "2026-07-18T12:15:00.000Z",
    });
  });
});
