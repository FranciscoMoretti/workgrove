import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repositoryCommandFingerprint,
  repositoryRequiresTrust,
} from "./repository-trust";
import {
  loadWorkgroveConfigDocument,
  repositoryCommandProfile,
  resolveSetupCommand,
  resolveStartCommands,
  resolveWorkgroveRuntime,
  updateRepositoryCommandProfile,
  updateWorkgroveConfig,
  type WorkgroveConfig,
} from "./workgrove-config";

const config: WorkgroveConfig = {
  version: 1,
  apps: {
    api: {
      control: { label: "API", open: false, probe: "tcp", required: true },
      exports: { API_PORT: "{port}" },
      port: { base: 8000 },
      start: {
        argv: ["python", "-m", "api", "--port", "{port}"],
        env: { PORT: "{port}" },
      },
    },
    web: {
      control: { label: "Web", open: true, probe: "tcp", required: true },
      exports: { PORT: "{port}", API_URL: "{apps.api.url}" },
      port: { base: 3000 },
      start: { argv: ["npm", "run", "dev"], env: { PORT: "{port}" } },
    },
  },
  ports: { slotStride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT", file: ".env.worktree.local" },
  url: "http://localhost:{port}",
};

describe("generic Workgrove configuration", () => {
  it("resolves and launches each app with its own environment", () => {
    expect(
      resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "3" }).apps
    ).toEqual({
      api: {
        env: { API_PORT: "8030" },
        port: 8030,
        url: "http://localhost:8030",
      },
      web: {
        env: { API_URL: "http://localhost:8030", PORT: "3030" },
        port: 3030,
        url: "http://localhost:3030",
      },
    });
    expect(resolveStartCommands(config, 3)).toEqual([
      {
        appId: "api",
        argv: ["python", "-m", "api", "--port", "8030"],
        cwd: null,
        env: { API_PORT: "8030", PORT: "8030", WORKGROVE_SLOT: "3" },
      },
      {
        appId: "web",
        argv: ["npm", "run", "dev"],
        cwd: null,
        env: {
          API_URL: "http://localhost:8030",
          PORT: "3030",
          WORKGROVE_SLOT: "3",
        },
      },
    ]);
  });

  it("requires trust when executable commands are configured", () => {
    expect(repositoryRequiresTrust(config)).toBe(true);
    expect(
      repositoryRequiresTrust({
        ...config,
        apps: Object.fromEntries(
          Object.entries(config.apps).map(([id, app]) => [
            id,
            { ...app, start: undefined },
          ])
        ),
      })
    ).toBe(false);
  });

  it("binds repository trust to the exact configured commands", () => {
    const fingerprint = repositoryCommandFingerprint(config);
    const apiArgv = config.apps.api.start?.argv;
    if (!apiArgv) {
      throw new Error("Test config requires an API start command");
    }
    expect(
      repositoryCommandFingerprint({
        ...config,
        apps: {
          ...config.apps,
          api: {
            ...config.apps.api,
            start: {
              argv: apiArgv,
              env: { B: "two", A: "one" },
            },
          },
        },
      })
    ).not.toBe(fingerprint);
    const orderedEnvironment = {
      ...config,
      apps: {
        ...config.apps,
        api: {
          ...config.apps.api,
          start: {
            argv: apiArgv,
            env: { B: "two", A: "one" },
          },
        },
      },
    };
    expect(repositoryCommandFingerprint(orderedEnvironment)).toBe(
      repositoryCommandFingerprint({
        ...orderedEnvironment,
        apps: {
          ...orderedEnvironment.apps,
          api: {
            ...orderedEnvironment.apps.api,
            start: {
              argv: apiArgv,
              env: { A: "one", B: "two" },
            },
          },
        },
      })
    );
  });

  it("rejects incomplete or ambiguous per-app command modes", () => {
    expect(() =>
      resolveWorkgroveRuntime(
        {
          ...config,
          apps: {
            ...config.apps,
            web: { ...config.apps.web, start: undefined },
          },
        },
        {}
      )
    ).toThrow("Required apps need start commands");
    expect(() =>
      resolveWorkgroveRuntime(
        { ...config, control: { start: { argv: ["npm", "run", "all"] } } },
        {}
      )
    ).toThrow("either per-app start commands or control.start");
  });

  it("resolves setup cwd, argv, and environment templates", () => {
    expect(
      resolveSetupCommand(
        {
          ...config,
          control: {
            setup: {
              argv: ["tool", "--port", "{apps.web.port}"],
              cwd: "packages/{slot}",
              env: { TARGET: "{url}" },
            },
          },
        },
        2
      )
    ).toEqual({
      appId: null,
      argv: ["tool", "--port", "3020"],
      cwd: "packages/2",
      env: { TARGET: "http://localhost:8020", WORKGROVE_SLOT: "2" },
    });
  });

  it("keeps legacy postCreate configuration readable as setup", () => {
    expect(
      resolveSetupCommand(
        {
          ...config,
          control: { postCreate: { argv: ["bun", "install"] } },
        },
        0
      )?.argv
    ).toEqual(["bun", "install"]);
  });

  it("atomically saves aggregate repository commands and canonicalizes setup", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-commands-"));
    const path = join(directory, ".workgrove.json");
    const aggregateConfig: WorkgroveConfig = {
      ...config,
      apps: Object.fromEntries(
        Object.entries(config.apps).map(([id, app]) => [
          id,
          { ...app, start: undefined },
        ])
      ),
      control: {
        postCreate: { argv: ["npm", "install"] },
        start: { argv: ["npm", "run", "dev"] },
      },
    };
    writeFileSync(path, `${JSON.stringify(aggregateConfig)}\n`);
    try {
      const saved = updateRepositoryCommandProfile(path, {
        setup: { argv: ["bun", "install"] },
        start: { argv: ["bun", "dev"] },
      });
      expect(repositoryCommandProfile(saved)).toEqual({
        setup: { argv: ["bun", "install"] },
        start: { argv: ["bun", "dev"] },
        startMode: "aggregate",
      });
      expect(readFileSync(path, "utf8")).not.toContain("postCreate");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("preserves per-app start commands when only setup is edited", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-commands-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(path, `${JSON.stringify(config)}\n`);
    try {
      const saved = updateRepositoryCommandProfile(path, {
        setup: { argv: ["bun", "install"] },
      });
      expect(repositoryCommandProfile(saved)).toEqual({
        setup: { argv: ["bun", "install"] },
        start: null,
        startMode: "per-app",
      });
      expect(saved.apps.web.start?.argv).toEqual(["npm", "run", "dev"]);
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
        `${JSON.stringify({ ...config, url: "http://127.0.0.1:{port}" })}\n`
      );
      expect(() =>
        updateWorkgroveConfig(path, config, firstRead.revision)
      ).toThrow("configuration changed on disk");
      expect(loadWorkgroveConfigDocument(path).config.url).toBe(
        "http://127.0.0.1:{port}"
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
