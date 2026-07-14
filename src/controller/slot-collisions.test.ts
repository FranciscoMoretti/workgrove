import { describe, expect, it } from "bun:test";

import type { WorkgroveConfig } from "../config/workgrove-schema";
import {
  conflictingWorkgroveSlotIndexes,
  workgroveSlotCollisionOwners,
} from "./slot-collisions";

const config: WorkgroveConfig = {
  version: 1,
  apps: {
    api: { port: { base: 8000 } },
    web: { port: { base: 3000 } },
  },
  ports: { slotStride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT" },
  url: "http://localhost:{port}",
};

describe("worktree slot collisions", () => {
  it("marks exact port collisions even when slot numbers differ", () => {
    expect(conflictingWorkgroveSlotIndexes(config, [0, 1, 500, null])).toEqual(
      new Set([0, 2])
    );
  });

  it("reports every assigned worktree blocking a candidate slot", () => {
    const assigned = [
      { id: "main-id", name: "main", slot: 0 },
      { id: "feature-id", name: "feature", slot: 1000 },
    ];
    expect(workgroveSlotCollisionOwners(config, 500, assigned)).toEqual(
      assigned
    );
    expect(workgroveSlotCollisionOwners(config, 2, assigned)).toEqual([]);
  });
});
