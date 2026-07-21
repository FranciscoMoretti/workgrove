import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { selectRequestedWorktrees } from "../commands/command";
import { parseWorktreeList } from "../git/discover-worktrees";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../runtime/local-routing";
import { FileWorkgroveStateStore } from "../runtime/local-state";
import { WorkspaceController } from "./workspace-controller";
import { appGroupCanRestart, appsCanRestart } from "./workspace-snapshot";

class FakeRoutingEngine implements LocalRoutingEngine {
  async activate(_route: LocalRoute): Promise<void> {
    // Inspection does not activate routes.
  }
  async deactivate(_route: LocalRoute): Promise<void> {
    // Inspection does not deactivate routes.
  }
  observe(_route: LocalRoute): LocalRouteState {
    return "inactive";
  }
  url(hostname: string): string {
    return `http://${hostname}:1355`;
  }
}

describe("slot-free workspace inspection", () => {
  it("projects stable endpoint identity without allocating a backing port", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-controller-"));
    const statePath = join(root, ".local", "state.json");
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        join(root, ".workgrove.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["bun", "install"] },
          appGroups: {
            product: {
              name: "Product Apps",
              start: { argv: ["bun", "run", "dev"] },
              stop: { argv: ["bun", "run", "stop"] },
              env: { PORT: "{apps.web.port}" },
              apps: {
                web: { name: "Website", protocol: "http", readiness: "tcp" },
              },
            },
          },
        })
      );
      const controller = new WorkspaceController(undefined, {
        routing: new FakeRoutingEngine(),
        state: new FileWorkgroveStateStore(statePath),
      });

      const snapshot = controller.inspect(root);
      expect(snapshot.primaryAppGroup).toBe("product");
      expect(snapshot.worktrees[0]?.appGroups[0]).toMatchObject({
        health: "not-running",
        id: "product",
        name: "Product Apps",
        processRunning: false,
        stop: "command",
      });
      expect(snapshot.worktrees[0]?.appGroups[0]?.apps[0]).toEqual({
        directUrl: null,
        id: "web",
        label: "Website",
        listening: false,
        open: false,
        ownership: "none",
        port: null,
        protocol: "http",
        readiness: "waiting",
        routeState: "inactive",
        url: null,
      });
      expect(snapshot.trustCommands).toHaveLength(3);
      expect(readFileSync(statePath, "utf8")).toContain(
        `website.${snapshot.worktrees[0]?.branch}.workgrove-controller-`
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("git worktree discovery", () => {
  it("accepts arbitrary paths and detached worktrees", () => {
    expect(
      parseWorktreeList(`worktree /code/chat-js
HEAD abcdef0123456789
branch refs/heads/main

worktree /tmp/arbitrary-name
HEAD 1234567890abcdef
detached
`)
    ).toEqual([
      {
        branch: "main",
        head: "abcdef0123456789",
        path: "/code/chat-js",
        prunable: false,
      },
      {
        branch: null,
        head: "1234567890abcdef",
        path: "/tmp/arbitrary-name",
        prunable: false,
      },
    ]);
  });
});

describe("visible worktree scope", () => {
  it("limits bulk operations to the identifiers supplied by the table", () => {
    const worktrees = [{ id: "visible" }, { id: "hidden" }];
    expect(selectRequestedWorktrees(worktrees, ["visible"])).toEqual([
      { id: "visible" },
    ]);
  });
});

describe("app lifecycle availability", () => {
  it("offers restart for any running slot-free worktree or App group", () => {
    expect(appsCanRestart({ health: "running", processRunning: true })).toBe(
      true
    );
    expect(
      appsCanRestart({ health: "not-running", processRunning: false })
    ).toBe(false);
    expect(
      appGroupCanRestart({
        health: "partially-running",
        processRunning: false,
      })
    ).toBe(true);
  });
});

describe("controller command contract", () => {
  it("validates command input before invoking repository operations", async () => {
    const controller = new WorkspaceController();
    await expect(
      controller.execute("start-apps", {
        appGroupName: "",
        repoPath: "/not-inspected",
        worktreeId: "worktree",
      })
    ).rejects.toThrow();
  });

  it("rejects command working directories that escape through a symlink", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "workgrove-command-cwd-"));
    const root = join(sandbox, "worktree");
    const outside = join(sandbox, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    mkdirSync(join(root, "apps"));
    symlinkSync(outside, join(root, "linked"));
    try {
      const controller = new WorkspaceController();
      expect(controller.commandWorkingDirectory(root, "apps")).toBe(
        realpathSync(join(root, "apps"))
      );
      expect(() =>
        controller.commandWorkingDirectory(root, "../outside")
      ).toThrow("inside the worktree");
      expect(() => controller.commandWorkingDirectory(root, "linked")).toThrow(
        "inside the worktree"
      );
      expect(() => controller.commandWorkingDirectory(root, "missing")).toThrow(
        "must exist inside the worktree"
      );
    } finally {
      rmSync(sandbox, { force: true, recursive: true });
    }
  });
});
