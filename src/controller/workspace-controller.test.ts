import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectRequestedWorktrees } from "../commands/command";
import type { WorktreeEnvConfig } from "../config/workgrove-config";
import { parseWorktreeList } from "../git/discover-worktrees";
import { appHealth, resolveControlledApps } from "../runtime/app-health";
import { commandEnvironment } from "../runtime/command-environment";
import {
  parseSlotAssignments,
  resolveSlotFilePath,
  slotAssignmentsContent,
} from "../runtime/slot-file";
import { WorkspaceController } from "./workspace-controller";
import { appsCanRestart } from "./workspace-snapshot";

const config = {
  version: 2,
  setup: { argv: ["npm", "install"] },
  appGroups: {
    Apps: {
      slot: { default: 0, stride: 10 },
      start: { argv: ["bun", "run", "dev:all"] },
      stop: "process",
      apps: {
        chat: { basePort: 3000 },
        electron: { basePort: 3001 },
        site: { basePort: 3002 },
      },
    },
  },
  env: {
    CHAT_PORT: "{appGroups.Apps.apps.chat.port}",
    ELECTRON_PORT: "{appGroups.Apps.apps.electron.port}",
    SITE_PORT: "{appGroups.Apps.apps.site.port}",
  },
} satisfies WorktreeEnvConfig;

describe("controlled app configuration", () => {
  it("derives app labels and ports entirely from worktree config", () => {
    expect(resolveControlledApps(config, "Apps", 6)).toEqual([
      {
        id: "chat",
        label: "chat",
        open: true,
        port: 3060,
        probe: "tcp",
        required: true,
        url: "http://localhost:3060",
      },
      {
        id: "electron",
        label: "electron",
        open: true,
        port: 3061,
        probe: "tcp",
        required: true,
        url: "http://localhost:3061",
      },
      {
        id: "site",
        label: "site",
        open: true,
        port: 3062,
        probe: "tcp",
        required: true,
        url: "http://localhost:3062",
      },
    ]);
  });

  it("injects explicitly configured repository environment variables", () => {
    const singleAppConfig = {
      ...config,
      appGroups: {
        Apps: {
          ...config.appGroups.Apps,
          apps: { app: config.appGroups.Apps.apps.chat },
        },
      },
      env: { APP_PORT: "{appGroups.Apps.apps.app.port}" },
    } satisfies WorktreeEnvConfig;
    expect(commandEnvironment(singleAppConfig, { Apps: 4 })).toEqual({
      APP_PORT: "3040",
    });
    expect(commandEnvironment(config, { Apps: 4 })).toEqual({
      CHAT_PORT: "3040",
      ELECTRON_PORT: "3041",
      SITE_PORT: "3042",
    });
  });

  it("reports stopped, partial, and running from required configured probes", () => {
    const apps = resolveControlledApps(config, "Apps", 6);

    expect(appHealth(apps, new Set())).toBe("not-running");
    expect(appHealth(apps, new Set([3060]))).toBe("partially-running");
    expect(appHealth(apps, new Set([3060, 3061, 3062]))).toBe("running");
  });
});

describe("slot file updates", () => {
  it("serializes named App group slots", () => {
    expect(
      parseSlotAssignments(
        slotAssignmentsContent({ Apps: 3, Infrastructure: 0 })
      )
    ).toEqual({
      kind: "value",
      slots: { Apps: 3, Infrastructure: 0 },
    });
  });

  it("distinguishes malformed values from missing assignments", () => {
    expect(parseSlotAssignments("")).toEqual({ kind: "missing", slots: {} });
    expect(parseSlotAssignments("not json")).toEqual({
      kind: "invalid",
      raw: "not json",
    });
  });

  it("rejects paths that escape the worktree or traverse a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-slot-"));
    mkdirSync(join(root, "config"));
    symlinkSync(tmpdir(), join(root, "config", "linked"));
    try {
      expect(() => resolveSlotFilePath(root, "../outside.env")).toThrow();
      expect(() =>
        resolveSlotFilePath(root, "config/linked/slot.env")
      ).toThrow();
      expect(resolveSlotFilePath(root, "config/slot.env")).toBe(
        join(realpathSync(root), "config", "slot.env")
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
  it("offers restart only to running worktrees with an assigned slot", () => {
    expect(
      appsCanRestart({
        health: "running",
        processRunning: true,
        slotState: "assigned",
      })
    ).toBe(true);
    expect(
      appsCanRestart({
        health: "running",
        processRunning: true,
        slotState: "invalid",
      })
    ).toBe(false);
    expect(
      appsCanRestart({
        health: "not-running",
        processRunning: false,
        slotState: "assigned",
      })
    ).toBe(false);
  });
});

describe("controller command contract", () => {
  it("validates command input before invoking repository operations", async () => {
    const controller = new WorkspaceController();
    await expect(
      controller.execute("set-slot", {
        repoPath: "/not-inspected",
        slot: -1,
        worktreeId: "worktree",
      })
    ).rejects.toThrow();
  });
});

describe("cross-group endpoint ownership", () => {
  it("marks groups invalid when their selected slots resolve to the same port", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-group-collision-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        join(root, ".workgrove.json"),
        JSON.stringify({
          version: 2,
          setup: { argv: ["true"] },
          appGroups: {
            Product: {
              slot: { default: 0, stride: 10 },
              start: { argv: ["true"] },
              stop: "process",
              apps: { Web: { basePort: 4000 } },
            },
            Infrastructure: {
              slot: { default: 0, stride: 20 },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
              apps: { Proxy: { basePort: 4000 } },
            },
          },
        })
      );
      const snapshot = new WorkspaceController().inspect(root);
      expect(
        snapshot.worktrees[0]?.appGroups.map((group) => group.slotState)
      ).toEqual(["conflicting", "conflicting"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
