import { describe, expect, it } from "bun:test";

import type { AppGroupSnapshot } from "../../controller/workspace-snapshot";
import { appGroupCommandMenuItems } from "./app-group-actions-menu";

function group(health: AppGroupSnapshot["health"]): AppGroupSnapshot {
  return {
    apps: [],
    health,
    id: "product",
    name: "Product Apps",
    processRunning: false,
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
  it("offers start for a stopped group", () => {
    expect(itemIds(group("not-running"))).toEqual(["start"]);
  });

  it("offers stop and restart for a running group", () => {
    expect(itemIds(group("running"))).toEqual(["stop", "restart"]);
  });

  it("offers stop and restart while a group is partially running", () => {
    expect(itemIds(group("partially-running"))).toEqual(["stop", "restart"]);
  });
});
