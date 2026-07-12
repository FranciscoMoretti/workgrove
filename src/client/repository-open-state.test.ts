import { describe, expect, it } from "bun:test";

import { WorkgroveApiError } from "./api";
import { missingConfigPath } from "./repository-open-state";

describe("repository onboarding", () => {
  it("recognizes only the structured missing-config response", () => {
    expect(
      missingConfigPath(
        new WorkgroveApiError(
          "This copy can change without breaking the UI",
          "missing_worktree_config",
          "/code/project/.workgrove.json"
        )
      )
    ).toBe("/code/project/.workgrove.json");
    expect(
      missingConfigPath(new WorkgroveApiError("Git command failed", null, null))
    ).toBeNull();
  });
});
