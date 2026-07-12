import { describe, expect, it } from "bun:test";
import {
  repositoryFingerprint,
  repositoryRequiresTrust,
} from "./repository-trust";
import {
  resolvePostCreateCommand,
  resolveStartCommands,
  resolveWorkgroveRuntime,
  type WorkgroveConfig,
} from "./workgrove-config";

const config: WorkgroveConfig = {
  version: 1,
  apps: {
    api: {
      control: { label: "API", open: false, probe: "tcp", required: true },
      exports: { API_PORT: "{port}" },
      offset: 1,
      start: {
        argv: ["python", "-m", "api", "--port", "{port}"],
        env: { PORT: "{port}" },
      },
    },
    web: {
      control: { label: "Web", open: true, probe: "tcp", required: true },
      exports: { PORT: "{port}", API_URL: "{apps.api.url}" },
      offset: 0,
      start: { argv: ["npm", "run", "dev"], env: { PORT: "{port}" } },
    },
  },
  range: { base: 4000, stride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT", file: ".env.worktree.local" },
  url: "http://localhost:{port}",
};

describe("generic Workgrove configuration", () => {
  it("resolves and launches each app with its own environment", () => {
    expect(
      resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "3" }).apps
    ).toEqual({
      api: {
        env: { API_PORT: "4031" },
        port: 4031,
        url: "http://localhost:4031",
      },
      web: {
        env: { API_URL: "http://localhost:4031", PORT: "4030" },
        port: 4030,
        url: "http://localhost:4030",
      },
    });
    expect(resolveStartCommands(config, 3)).toEqual([
      {
        appId: "api",
        argv: ["python", "-m", "api", "--port", "4031"],
        cwd: null,
        env: { API_PORT: "4031", PORT: "4031", WORKGROVE_SLOT: "3" },
      },
      {
        appId: "web",
        argv: ["npm", "run", "dev"],
        cwd: null,
        env: {
          API_URL: "http://localhost:4031",
          PORT: "4030",
          WORKGROVE_SLOT: "3",
        },
      },
    ]);
  });

  it("changes trust identity when executable commands change", () => {
    expect(repositoryRequiresTrust(config)).toBe(true);
    expect(repositoryFingerprint(config)).not.toBe(
      repositoryFingerprint({
        ...config,
        apps: {
          ...config.apps,
          web: { ...config.apps.web, start: { argv: ["npm", "run", "other"] } },
        },
      })
    );
    expect(repositoryFingerprint(config)).not.toBe(
      repositoryFingerprint({
        ...config,
        apps: {
          ...config.apps,
          web: {
            ...config.apps.web,
            exports: { NODE_OPTIONS: "--require hook" },
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

  it("resolves post-create cwd, argv, and environment templates", () => {
    expect(
      resolvePostCreateCommand(
        {
          ...config,
          control: {
            postCreate: {
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
      argv: ["tool", "--port", "4020"],
      cwd: "packages/2",
      env: { TARGET: "http://localhost:4021", WORKGROVE_SLOT: "2" },
    });
  });
});
