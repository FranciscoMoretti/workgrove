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
};

function worktree(
  health: WorktreeSnapshot["health"],
  overrides: Partial<WorktreeSnapshot> = {}
): WorktreeSnapshot {
  return {
    appLabel: "App",
    apps: [],
    appGroups: [
      {
        apps: [],
        health,
        name: "Apps",
        processRunning: false,
        slot: 0,
        slotState: "assigned",
        stop: "process",
      },
    ],
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
  it("can keep lifecycle controls out of a worktree-level menu", () => {
    expect(
      worktreeCommandMenuItems({
        actions,
        includeLifecycle: false,
        pending: false,
        worktree: worktree("running"),
      }).map((item) => item.id)
    ).toEqual(["setup"]);
  });

  it("offers setup and start when stopped", () => {
    expect(itemIds(worktree("not-running"))).toEqual(["setup", "start"]);
  });

  it("offers setup, stop, and group restart when partially running", () => {
    expect(itemIds(worktree("partially-running"))).toEqual([
      "setup",
      "stop",
      "restart",
    ]);
  });

  it("offers setup, stop, and restart when fully running", () => {
    expect(itemIds(worktree("running"))).toEqual(["setup", "stop", "restart"]);
  });

  it("keeps start visible but disabled for an invalid slot", () => {
    const items = worktreeCommandMenuItems({
      actions,
      pending: false,
      worktree: worktree("not-running", {
        slot: 0,
        slotState: "invalid",
      }),
    });
    expect(items.find((item) => item.id === "start")?.disabled).toBe(true);
  });

  it("does not offer restart for an invalid app group slot", () => {
    expect(
      itemIds(worktree("running", { slot: 0, slotState: "invalid" }))
    ).toEqual(["setup", "stop"]);
  });
});
