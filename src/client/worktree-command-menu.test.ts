import { describe, expect, it } from "bun:test";

import type { WorktreeSnapshot } from "../controller/workspace-snapshot";
import {
  type WorktreeCommandActions,
  worktreeCommandMenuItems,
} from "./worktree-command-menu";

const actions: WorktreeCommandActions = {
  onRestart: () => undefined,
  onSetup: () => undefined,
  onStart: () => undefined,
  onStop: () => undefined,
  setupAvailable: true,
};

function worktree(
  health: WorktreeSnapshot["health"],
  overrides: Partial<WorktreeSnapshot> = {}
): WorktreeSnapshot {
  return {
    appLabel: "App",
    apps: [],
    branch: "main",
    health,
    id: "worktree",
    isMain: true,
    name: "repo",
    path: "/repo",
    processRunning: false,
    setupState: "idle",
    slot: 0,
    slotState: "assigned",
    ...overrides,
  };
}

function itemIds(target: WorktreeSnapshot): string[] {
  return worktreeCommandMenuItems({
    actions,
    pending: false,
    worktree: target,
  }).map((item) => item.id);
}

describe("worktree command menu", () => {
  it("offers setup and start when stopped", () => {
    expect(itemIds(worktree("not-running"))).toEqual(["setup", "start"]);
  });

  it("offers setup and stop when partially running", () => {
    expect(itemIds(worktree("partially-running"))).toEqual(["setup", "stop"]);
  });

  it("offers setup, stop, and restart when fully running", () => {
    expect(itemIds(worktree("running"))).toEqual(["setup", "stop", "restart"]);
  });

  it("keeps start visible but disabled until a slot is assigned", () => {
    const items = worktreeCommandMenuItems({
      actions,
      pending: false,
      worktree: worktree("not-running", {
        slot: null,
        slotState: "unassigned",
      }),
    });
    expect(items.find((item) => item.id === "start")?.disabled).toBe(true);
  });

  it("does not offer restart for a partial or unassigned runtime", () => {
    expect(
      itemIds(worktree("running", { slot: null, slotState: "unassigned" }))
    ).toEqual(["setup", "stop"]);
  });

  it("keeps setup visible but disabled when no setup command is configured", () => {
    const items = worktreeCommandMenuItems({
      actions: { ...actions, setupAvailable: false },
      pending: false,
      worktree: worktree("not-running"),
    });
    expect(items.find((item) => item.id === "setup")?.disabled).toBe(true);
  });
});
