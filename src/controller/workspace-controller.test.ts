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
  start: { argv: ["bun", "run", "dev:all"] },
  apps: {
    chat: { basePort: 3000 },
    electron: { basePort: 3001 },
    site: { basePort: 3002 },
  },
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
        label: "Electron",
        open: true,
        port: 3061,
        probe: "tcp",
        required: true,
        url: "http://localhost:3061",
      },
      {
        id: "site",
        label: "Site",
        open: true,
        port: 3062,
        probe: "tcp",
        required: true,
        url: "http://localhost:3062",
      },
    ]);
  });

  it("injects automatic app port environment variables", () => {
    const singleAppConfig = {
      ...config,
      apps: { app: config.apps.chat },
    } satisfies WorktreeEnvConfig;
    expect(commandEnvironment(singleAppConfig, 4)).toEqual({
      WORKGROVE_APP_PORT: "3040",
      WORKGROVE_SLOT: "4",
    });
    expect(commandEnvironment(config, 4)).toEqual({
      WORKGROVE_CHAT_PORT: "3040",
      WORKGROVE_ELECTRON_PORT: "3041",
      WORKGROVE_SITE_PORT: "3042",
      WORKGROVE_SLOT: "4",
    });
  });

  it("reports stopped, partial, and running from required configured probes", () => {
    const apps = resolveControlledApps(config, 6);

    expect(appHealth(apps, new Set())).toBe("not-running");
    expect(appHealth(apps, new Set([3060]))).toBe("partially-running");
    expect(appHealth(apps, new Set([3060, 3061, 3062]))).toBe("running");
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
