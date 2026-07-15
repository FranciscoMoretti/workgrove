import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repositoryCommandFingerprint,
  repositoryRequiresTrust,
} from "./repository-trust";
import {
  loadWorkgroveConfigDocument,
  resolveSetupCommand,
  resolveStartCommand,
  resolveWorkgroveRuntime,
  updateWorkgroveConfig,
  type WorkgroveConfig,
} from "./workgrove-config";

const config: WorkgroveConfig = {
  version: 1,
  setup: { argv: ["bun", "install"] },
  start: { argv: ["bun", "run", "dev"] },
  apps: {
    api: { basePort: 8000 },
    web: { basePort: 3000 },
  },
};

describe("generic Workgrove configuration", () => {
  it("resolves one app-group start command with every app port", () => {
    expect(resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "3" })).toEqual({
      apps: {
        api: { port: 8030, url: "http://localhost:8030" },
        web: { port: 3030, url: "http://localhost:3030" },
      },
      slot: 3,
    });
    expect(resolveStartCommand(config, 3)).toEqual({
      argv: ["bun", "run", "dev"],
      env: {
        WORKGROVE_API_PORT: "8030",
        WORKGROVE_SLOT: "3",
        WORKGROVE_WEB_PORT: "3030",
      },
    });
  });

  it("runs setup from the same repository-wide environment", () => {
    expect(resolveSetupCommand(config, 2)).toEqual({
      argv: ["bun", "install"],
      env: {
        WORKGROVE_API_PORT: "8020",
        WORKGROVE_SLOT: "2",
        WORKGROVE_WEB_PORT: "3020",
      },
    });
  });

  it("requires trust only for the two repository commands", () => {
    expect(repositoryRequiresTrust(config)).toBe(true);
    expect(repositoryRequiresTrust({ ...config, setup: undefined })).toBe(true);
    expect(
      repositoryRequiresTrust({
        ...config,
        setup: undefined,
        start: undefined,
      })
    ).toBe(false);
    expect(
      repositoryCommandFingerprint({
        ...config,
        start: { argv: ["bun", "run", "dev:all"] },
      })
    ).not.toBe(repositoryCommandFingerprint(config));
  });

  it("rejects stale visual-editor saves without overwriting newer changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-config-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(path, `${JSON.stringify(config)}\n`);
    try {
      const firstRead = loadWorkgroveConfigDocument(path);
      writeFileSync(
        path,
        `${JSON.stringify({ ...config, apps: { web: { basePort: 4000 } } })}\n`
      );
      expect(() =>
        updateWorkgroveConfig(path, config, firstRead.revision)
      ).toThrow("configuration changed on disk");
      expect(loadWorkgroveConfigDocument(path).config.apps.web.basePort).toBe(
        4000
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects malformed worktree slots", () => {
    expect(() =>
      resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "invalid" })
    ).toThrow('Invalid WORKGROVE_SLOT "invalid"');
  });
});
