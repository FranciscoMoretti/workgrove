import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectRequestedWorktrees } from "../commands/command";
import type { WorktreeEnvConfig } from "../config/workgrove-config";
import { parseWorktreeList } from "../git/discover-worktrees";
import { appHealth, resolveControlledApps } from "../runtime/app-health";
import { commandEnvironment } from "../runtime/command-environment";
import {
  parseSlotFromContent,
  resolveSlotFilePath,
  updateSlotFileContent,
} from "../runtime/slot-file";
import { WorkspaceController } from "./workspace-controller";
import { appsCanRestart } from "./workspace-snapshot";

const config = {
  version: 1,
  slot: { default: 0, env: "CHATJS_DEV_SLOT", file: ".env.worktree.local" },
  range: { base: 3000, stride: 10 },
  url: "http://localhost:{port}",
  apps: {
    chat: {
      offset: 0,
      exports: { APP_URL: "{url}", PORT: "{port}" },
      control: { label: "Chat", open: true, probe: "tcp", required: true },
    },
    electron: {
      offset: 1,
      exports: { ELECTRON_APP_URL: "{apps.chat.url}" },
      control: {
        label: "Desktop",
        open: false,
        probe: "none",
        required: false,
      },
    },
    site: {
      offset: 2,
      exports: { PORT: "{port}" },
      control: { label: "Docs Site", open: true, probe: "tcp", required: true },
    },
  },
  control: { start: { argv: ["bun", "run", "dev:all"] } },
} satisfies WorktreeEnvConfig;

describe("controlled app configuration", () => {
  it("derives app labels and ports entirely from worktree config", () => {
    expect(resolveControlledApps(config, 6)).toEqual([
      {
        id: "chat",
        label: "Chat",
        open: true,
        port: 3060,
        probe: "tcp",
        required: true,
        url: "http://localhost:3060",
      },
      {
        id: "electron",
        label: "Desktop",
        open: false,
        port: 3061,
        probe: "none",
        required: false,
        url: "http://localhost:3061",
      },
      {
        id: "site",
        label: "Docs Site",
        open: true,
        port: 3062,
        probe: "tcp",
        required: true,
        url: "http://localhost:3062",
      },
    ]);
  });

  it("injects resolved exports for a generated single-app start command", () => {
    const singleAppConfig = {
      ...config,
      apps: { app: config.apps.chat },
      slot: { ...config.slot, env: "WORKGROVE_SLOT" },
    } satisfies WorktreeEnvConfig;
    expect(commandEnvironment(singleAppConfig, 4)).toEqual({
      APP_URL: "http://localhost:3040",
      PORT: "3040",
      WORKGROVE_SLOT: "4",
    });
    expect(commandEnvironment(config, 4)).toEqual({ CHATJS_DEV_SLOT: "4" });
  });

  it("reports stopped, partial, and running from required configured probes", () => {
    const apps = resolveControlledApps(config, 6);

    expect(appHealth(apps, new Set())).toBe("not-running");
    expect(appHealth(apps, new Set([3060]))).toBe("partially-running");
    expect(appHealth(apps, new Set([3060, 3062]))).toBe("running");
  });
});

describe("slot file updates", () => {
  it("changes only the configured slot variable and preserves dialog-worthy context", () => {
    expect(
      updateSlotFileContent(
        "# local worktree settings\nKEEP_ME=yes\nCHATJS_DEV_SLOT=2\n",
        "CHATJS_DEV_SLOT",
        7
      )
    ).toBe("# local worktree settings\nKEEP_ME=yes\nCHATJS_DEV_SLOT=7\n");
  });

  it("appends a missing slot variable", () => {
    expect(updateSlotFileContent("KEEP_ME=yes", "CHATJS_DEV_SLOT", 3)).toBe(
      "KEEP_ME=yes\nCHATJS_DEV_SLOT=3\n"
    );
  });

  it("distinguishes malformed values from missing assignments", () => {
    expect(parseSlotFromContent("KEEP_ME=yes\n", "CHATJS_DEV_SLOT")).toEqual({
      kind: "missing",
    });
    expect(
      parseSlotFromContent("CHATJS_DEV_SLOT=oops\n", "CHATJS_DEV_SLOT")
    ).toEqual({ kind: "invalid", raw: "oops" });
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
        slotState: "conflicting",
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
