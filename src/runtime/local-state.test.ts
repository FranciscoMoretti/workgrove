import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileWorkgroveStateStore } from "./local-state";

describe("Workgrove local endpoint state", () => {
  it("keeps a collision-free Friendly hostname stable", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const statePath = join(directory, "state.json");
      const firstStore = new FileWorkgroveStateStore(statePath);
      const first = firstStore.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "development",
        repoLabel: "chat-js",
        repoPath: "/code/one/chat-js",
        worktreeLabel: "main",
        worktreePath: "/code/one/chat-js",
      });
      const restored = new FileWorkgroveStateStore(statePath).endpoint({
        appId: "web",
        appLabel: "Renamed Web",
        groupId: "development",
        repoLabel: "chat-js",
        repoPath: "/code/one/chat-js",
        worktreeLabel: "renamed-main",
        worktreePath: "/code/one/chat-js",
      });
      const otherRepository = firstStore.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "development",
        repoLabel: "chat-js",
        repoPath: "/code/two/chat-js",
        worktreeLabel: "main",
        worktreePath: "/code/two/chat-js",
      });

      expect(restored).toEqual(first);
      expect(first.hostname).toBe("web.main.chat-js.localhost");
      expect(otherRepository.hostname).not.toBe(first.hostname);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
