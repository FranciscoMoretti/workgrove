import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  repositoryCommandFingerprint,
  repositoryIsTrusted,
} from "./repository-trust";
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
  it("fails closed when any persisted trust entry has an invalid shape", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-trust-"));
    try {
      const repoPath = "/code/chat-js";
      writeFileSync(
        join(directory, "trusted-repositories.json"),
        JSON.stringify({
          [repoPath]: repositoryCommandFingerprint(config("per-worktree")),
          "/code/invalid": { trusted: true },
        })
      );

      expect(
        repositoryIsTrusted(repoPath, config("per-worktree"), directory)
      ).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("changes when App-group instance semantics change", () => {
    expect(repositoryCommandFingerprint(config("per-worktree"))).not.toBe(
      repositoryCommandFingerprint(config("selectable"))
    );
  });
});
