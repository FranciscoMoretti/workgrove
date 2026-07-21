import { describe, expect, it } from "bun:test";

import type { WorkspaceController } from "../controller/workspace-controller";
import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import { restartRunningApps } from "./restart-running-apps";
import { findAppGroup } from "./start-apps";

function group(id: string): AppGroupSnapshot {
  return {
    apps: [],
    health: "running",
    id,
    name: "Shared display name",
    processRunning: true,
    stop: "process",
  };
}

function worktree(): WorktreeSnapshot {
  return {
    appGroups: [group("first"), group("second")],
    appLabel: "Apps",
    apps: [],
    branch: "main",
    health: "running",
    id: "worktree",
    isMain: true,
    name: "repo",
    path: "/repo",
    processRunning: true,
    setupState: "idle",
  };
}

function fakeController(target: WorktreeSnapshot): {
  controller: WorkspaceController;
  starts: string[];
  stops: string[];
} {
  const starts: string[] = [];
  const stops: string[] = [];
  const controller = {
    inspect: () => ({ worktrees: [target] }),
    startAppGroup: (_repo: string, _worktree: string, id: string) => {
      starts.push(id);
      const item = findAppGroup(target, id);
      item.health = "running";
      item.processRunning = true;
      return Promise.resolve("started" as const);
    },
    stopAppGroup: (_repo: string, _worktree: string, id: string) => {
      stops.push(id);
      const item = findAppGroup(target, id);
      item.health = "not-running";
      item.processRunning = false;
      return Promise.resolve("stopped" as const);
    },
    worktree: () => ({ worktree: target }),
  } as unknown as WorkspaceController;
  return { controller, starts, stops };
}

describe("restart running App groups", () => {
  it("targets every stable ID even when display names collide", async () => {
    const target = worktree();
    const fake = fakeController(target);

    await restartRunningApps(fake.controller, {
      repoPath: "/repo",
      worktreeIds: [target.id],
    });

    expect(fake.stops).toEqual(["first", "second"]);
    expect(fake.starts).toEqual(["first", "second"]);
  });

  it("filters by stable ID rather than display name", async () => {
    const target = worktree();
    const fake = fakeController(target);

    await restartRunningApps(fake.controller, {
      appGroupName: "second",
      repoPath: "/repo",
      worktreeIds: [target.id],
    });

    expect(fake.stops).toEqual(["second"]);
    expect(fake.starts).toEqual(["second"]);
  });

  it("does not resolve ambiguous display names as command identities", () => {
    const target = worktree();
    expect(findAppGroup(target, "first").id).toBe("first");
    expect(() => findAppGroup(target, "Shared display name")).toThrow(
      "Unknown App group"
    );
  });
});
