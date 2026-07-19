import { describe, expect, it } from "bun:test";

import { CodexIntegrationSnapshotSchema } from "../codex/codex-integration";
import { WorkspaceSnapshotSchema } from "./schemas";

describe("workspace snapshot transport schema", () => {
  it("preserves slot-free App groups and endpoint lifecycle state", () => {
    const snapshot = WorkspaceSnapshotSchema.parse({
      config: {
        version: 1,
        setup: { argv: ["bun", "install"] },
        appGroups: {
          product: {
            name: "Product Apps",
            start: { argv: ["bun", "run", "dev"] },
            stop: "process",
            apps: { web: { protocol: "http", readiness: "tcp" } },
          },
        },
      },
      configPath: "/repo/.workgrove.json",
      configRevision: "revision",
      globalProcesses: [],
      globalRunningCount: 1,
      mainWorktreePath: "/repo",
      primaryAppGroup: "product",
      repoName: "repo",
      repoPath: "/repo",
      trustCommands: [],
      trustRequired: true,
      trusted: true,
      updatedAt: "2026-07-14T00:00:00.000Z",
      worktrees: [
        {
          appGroups: [
            {
              apps: [
                {
                  directUrl: "http://127.0.0.1:49152",
                  id: "web",
                  label: "web",
                  listening: true,
                  open: true,
                  ownership: "owned",
                  port: 49_152,
                  protocol: "http",
                  readiness: "ready",
                  routeState: "active",
                  url: "http://web.main.repo.localhost:1355",
                },
              ],
              health: "running",
              id: "product",
              name: "Product Apps",
              processRunning: true,
              stop: "process",
            },
          ],
          appLabel: "Product Apps",
          apps: [],
          branch: "main",
          health: "running",
          id: "worktree",
          isMain: true,
          name: "repo",
          path: "/repo",
          processRunning: true,
          setupState: "idle",
        },
      ],
    });

    expect(snapshot.worktrees[0]?.appGroups[0]?.apps[0]?.routeState).toBe(
      "active"
    );
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
