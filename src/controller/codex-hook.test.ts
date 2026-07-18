import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexHookActivityStore } from "../codex/codex-hook-activity";
import { FakeCodexIntegrationAdapter } from "../codex/codex-integration";
import { WorkspaceController } from "./workspace-controller";

function writeConfig(root: string): void {
  writeFileSync(
    join(root, ".workgrove.json"),
    JSON.stringify({
      appGroups: {
        App: {
          apps: { Web: { basePort: 4000 } },
          slot: { default: 0, stride: 10 },
          start: { argv: ["true"] },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 2,
    })
  );
}

describe("WorkspaceController Codex hook bridge", () => {
  it("correlates exact task identity and cwd without exposing unmatched observations", async () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-codex-hook-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeConfig(root);
      const canonicalRoot = realpathSync(root);
      const task = {
        activity: null,
        contextSharedAt: null,
        createdAt: "2026-07-17T10:00:00.000Z",
        id: "task-a",
        title: "Lifecycle bridge",
        updatedAt: "2026-07-18T12:00:00.000Z",
      };
      const adapter = new FakeCodexIntegrationAdapter({
        tasks: [{ task, worktreePath: canonicalRoot }],
        updatedAt: "2026-07-18T12:00:00.000Z",
      });
      const activity = new CodexHookActivityStore({ persist: false });
      const controller = new WorkspaceController(adapter, {
        codexHooks: activity,
      });
      const worktreeId = controller.inspect(root).worktrees[0].id;
      await controller.inspectCodex(root);

      expect(
        controller.observeCodexHook({
          cwd: canonicalRoot,
          event: "UserPromptSubmit",
          sessionId: "task-a",
          turnId: "turn-1",
          version: 1,
        })
      ).toBe(true);
      expect(
        controller.observeCodexHook({
          cwd: canonicalRoot,
          event: "UserPromptSubmit",
          sessionId: "task-not-discovered",
          turnId: "turn-2",
          version: 1,
        })
      ).toBe(true);
      controller.observeCodexHook({
        cwd: canonicalRoot,
        event: "PostToolUse",
        sessionId: "task-not-discovered",
        turnId: "turn-2",
        version: 1,
      });

      const nested = join(canonicalRoot, "nested");
      mkdirSync(nested);
      controller.observeCodexHook({
        cwd: nested,
        event: "PermissionRequest",
        sessionId: "task-a",
        turnId: "turn-3",
        version: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      const projection = await controller.inspectCodex(root);
      expect(adapter.requests).toHaveLength(3);
      expect(
        activity.applyToSnapshot({
          tasks: [
            {
              task: { ...task, id: "task-not-discovered" },
              worktreePath: canonicalRoot,
            },
          ],
          updatedAt: "2026-07-18T12:00:00.000Z",
        }).tasks[0].task.activity
      ).toBeNull();
      expect(projection.worktrees[worktreeId].tasks).toHaveLength(1);
      expect(projection.worktrees[worktreeId].tasks[0]).toMatchObject({
        activity: { state: "working", subagentCount: 0 },
        id: "task-a",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ignores worktrees without a valid root configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-codex-hook-invalid-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(join(root, ".workgrove.json"), '{"version":2}');
      const controller = new WorkspaceController(
        new FakeCodexIntegrationAdapter({
          tasks: [],
          updatedAt: "2026-07-18T12:00:00.000Z",
        }),
        { codexHooks: new CodexHookActivityStore({ persist: false }) }
      );

      expect(
        controller.observeCodexHook({
          cwd: root,
          event: "SessionStart",
          sessionId: "task-a",
          source: "startup",
          version: 1,
        })
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
