import { describe, expect, it } from "bun:test";

import { repositoryCommandFingerprint } from "./repository-trust";
import { WorkgroveConfigSchema } from "./workgrove-schema";

function config(mode: "per-worktree" | "selectable") {
  return WorkgroveConfigSchema.parse({
    version: 1,
    setup: { argv: ["true"] },
    appGroups: {
      Apps: {
        apps: { Web: { protocol: "http" } },
        instances: { mode },
        start: { argv: ["true"] },
        stop: "process",
      },
    },
  });
}

describe("repository trust fingerprint", () => {
  it("changes when App-group instance semantics change", () => {
    expect(repositoryCommandFingerprint(config("per-worktree"))).not.toBe(
      repositoryCommandFingerprint(config("selectable"))
    );
  });
});
