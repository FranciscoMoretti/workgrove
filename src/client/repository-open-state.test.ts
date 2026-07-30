import { describe, expect, it } from "bun:test";

import { BranchBaseApiError } from "./api";
import { missingConfigPath } from "./repository-open-state";

describe("repository onboarding", () => {
  it("recognizes only the structured missing-config response", () => {
    expect(
      missingConfigPath(
        new BranchBaseApiError(
          "This copy can change without breaking the UI",
          "missing_worktree_config",
          "/code/project/.branchbase.json"
        )
      )
    ).toBe("/code/project/.branchbase.json");
    expect(
      missingConfigPath(
        new BranchBaseApiError("Git command failed", null, null)
      )
    ).toBeNull();
  });
});
