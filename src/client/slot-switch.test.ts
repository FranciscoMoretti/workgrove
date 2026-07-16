import { describe, expect, it } from "bun:test";

import { runSlotSwitch } from "./slot-switch";

describe("slot switching", () => {
  it("stops apps before changing the slot and starts them afterward", async () => {
    const calls: string[] = [];

    await runSlotSwitch(
      {
        setSlot: (input) => {
          calls.push(`set:${input.slot}`);
          return Promise.resolve();
        },
        startApps: () => {
          calls.push("start");
          return Promise.resolve();
        },
        stopApps: () => {
          calls.push("stop");
          return Promise.resolve();
        },
      },
      { repoPath: "/repo", slot: 2, worktreeId: "worktree" }
    );

    expect(calls).toEqual(["stop", "set:2", "start"]);
  });
});
