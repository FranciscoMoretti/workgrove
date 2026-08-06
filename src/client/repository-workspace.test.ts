import { describe, expect, it } from "bun:test";

import type { WorktreeSnapshot } from "../controller/workspace-snapshot";
import { selectedGroupId } from "./repository-workspace";

describe("repository workspace selection", () => {
  it("falls back to the new primary group when a selected group disappears", () => {
    const worktree = {
      appGroups: [{ id: "new-primary" }],
      primaryAppGroup: "new-primary",
    } as WorktreeSnapshot;

    expect(selectedGroupId(worktree, "removed-group", "default")).toBe(
      "new-primary"
    );
    expect(selectedGroupId(worktree, "new-primary", "default")).toBe(
      "new-primary"
    );
  });
});
