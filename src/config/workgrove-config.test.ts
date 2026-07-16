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
  resolveWorkgroveAppGroup,
  updateWorkgroveConfig,
  type WorkgroveConfig,
} from "./workgrove-config";

const config: WorkgroveConfig = {
  version: 1,
  stride: 20,
  setup: { argv: ["bun", "install"] },
  start: { argv: ["bun", "run", "dev"] },
  apps: {
    api: { basePort: 8000 },
    web: { basePort: 3000 },
  },
  env: {
    API_PORT: "{apps.api.port}",
    WEB_ORIGIN: "{apps.web.url}",
    WORKTREE_NUMBER: "{slot}",
  },
};

describe("generic Workgrove configuration", () => {
  it("resolves one app-group start command with every app port", () => {
    expect(resolveWorkgroveAppGroup(config, { WORKGROVE_SLOT: "3" })).toEqual({
      apps: {
        api: { port: 8060, url: "http://localhost:8060" },
        web: { port: 3060, url: "http://localhost:3060" },
      },
      slot: 3,
    });
    expect(resolveStartCommand(config, 3)).toEqual({
      argv: ["bun", "run", "dev"],
      env: {
        API_PORT: "8060",
        WORKGROVE_SLOT: "3",
        WEB_ORIGIN: "http://localhost:3060",
        WORKTREE_NUMBER: "3",
      },
    });
  });

  it("runs setup from the same repository-wide environment", () => {
    expect(resolveSetupCommand(config, 2)).toEqual({
      argv: ["bun", "install"],
      env: {
        API_PORT: "8040",
        WORKGROVE_SLOT: "2",
        WEB_ORIGIN: "http://localhost:3040",
        WORKTREE_NUMBER: "2",
      },
    });
  });

  it("requires trust only for the two repository commands", () => {
    expect(repositoryRequiresTrust(config)).toBe(true);
    expect(
      repositoryCommandFingerprint({
        ...config,
        start: { argv: ["bun", "run", "dev:all"] },
      })
    ).not.toBe(repositoryCommandFingerprint(config));
    expect(
      repositoryCommandFingerprint({
        ...config,
        env: { ...config.env, NODE_OPTIONS: "--inspect" },
      })
    ).not.toBe(repositoryCommandFingerprint(config));
  });

  it("loads legacy version-one files with the required command defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-legacy-config-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(
      path,
      `${JSON.stringify({ version: 1, stride: 10, apps: config.apps })}\n`
    );
    try {
      expect(loadWorkgroveConfigDocument(path).config).toMatchObject({
        setup: { argv: ["npm", "install"] },
        start: { argv: ["npm", "run", "dev"] },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects stale visual-editor saves without overwriting newer changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-config-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(path, `${JSON.stringify(config)}\n`);
    try {
      const firstRead = loadWorkgroveConfigDocument(path);
      writeFileSync(
        path,
        `${JSON.stringify({
          ...config,
          apps: { ...config.apps, web: { basePort: 4000 } },
        })}\n`
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
      resolveWorkgroveAppGroup(config, { WORKGROVE_SLOT: "invalid" })
    ).toThrow('Invalid WORKGROVE_SLOT "invalid"');
  });
});
