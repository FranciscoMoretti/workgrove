import { describe, expect, it } from "bun:test";

import type { AppGroupSnapshot } from "../../controller/workspace-snapshot";
import { appGroupCommandMenuItems } from "./app-group-actions-menu";

function group(
  health: AppGroupSnapshot["health"],
  slotState: AppGroupSnapshot["slotState"] = "assigned"
): AppGroupSnapshot {
  return {
    apps: [],
    health,
    name: "Product Apps",
    processRunning: false,
    slot: 0,
    slotState,
    stop: "process",
  };
}

function itemIds(target: AppGroupSnapshot): string[] {
  return appGroupCommandMenuItems({
    group: target,
    onRestart: () => undefined,
    onToggle: () => undefined,
    pending: false,
  }).map((item) => item.id);
}

describe("app group actions menu", () => {
  it("offers start for a stopped group with an assigned slot", () => {
    expect(itemIds(group("not-running"))).toEqual(["start"]);
  });

  it("offers stop and restart for a running group with an assigned slot", () => {
    expect(itemIds(group("running"))).toEqual(["stop", "restart"]);
  });

  it("does not offer restart for a running group with an invalid slot", () => {
    expect(itemIds(group("running", "invalid"))).toEqual(["stop"]);
  });
});
