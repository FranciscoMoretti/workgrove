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
  resolveStopCommand,
  resolveWorkgroveAppGroup,
  updateWorkgroveConfig,
  type WorkgroveConfig,
} from "./workgrove-config";

const config: WorkgroveConfig = {
  version: 2,
  setup: { argv: ["bun", "install"] },
  appGroups: {
    Apps: {
      slot: { default: 0, stride: 20 },
      start: { argv: ["bun", "run", "dev"] },
      stop: "process",
      apps: {
        API: { basePort: 8000 },
        Web: { basePort: 3000 },
      },
    },
    Infrastructure: {
      slot: { default: 0, stride: 100 },
      start: { argv: ["bun", "run", "infra:start"] },
      stop: { argv: ["bun", "run", "infra:stop"] },
      apps: { Postgres: { basePort: 5432 } },
    },
  },
  env: {
    API_PORT: "{appGroups.Apps.apps.API.port}",
    DB_PORT: "{appGroups.Infrastructure.apps.Postgres.port}",
    APPS_SLOT: "{appGroups.Apps.slot}",
  },
};

describe("generic Workgrove configuration", () => {
  it("resolves every App group independently", () => {
    expect(resolveWorkgroveAppGroup(config, "Apps", 3)).toEqual({
      apps: {
        API: { port: 8060, url: "http://localhost:8060" },
        Web: { port: 3060, url: "http://localhost:3060" },
      },
      name: "Apps",
      slot: 3,
    });
    expect(
      resolveStartCommand(config, "Apps", { Apps: 3, Infrastructure: 1 })
    ).toEqual({
      argv: ["bun", "run", "dev"],
      env: { API_PORT: "8060", APPS_SLOT: "3", DB_PORT: "5532" },
    });
  });

  it("resolves process and explicit command Stop strategies", () => {
    expect(resolveStopCommand(config, "Apps", {})).toBeNull();
    expect(resolveStopCommand(config, "Infrastructure", {})).toEqual({
      argv: ["bun", "run", "infra:stop"],
      env: { API_PORT: "8000", APPS_SLOT: "0", DB_PORT: "5432" },
    });
  });

  it("runs setup from the complete repository environment", () => {
    expect(resolveSetupCommand(config, { Apps: 2, Infrastructure: 1 })).toEqual(
      {
        argv: ["bun", "install"],
        env: { API_PORT: "8040", APPS_SLOT: "2", DB_PORT: "5532" },
      }
    );
  });

  it("renders exact names containing template delimiters", () => {
    const unusual: WorkgroveConfig = {
      version: 2,
      setup: { argv: ["true"] },
      appGroups: {
        "Curly } Group": {
          slot: { default: 0, stride: 10 },
          start: { argv: ["true"] },
          stop: "process",
          apps: { "API { Edge": { basePort: 9000 } },
        },
      },
      env: {
        PORT: "{appGroups.Curly } Group.apps.API { Edge.port}",
      },
    };
    expect(resolveStartCommand(unusual, "Curly } Group", {})).toEqual({
      argv: ["true"],
      env: { PORT: "9000" },
    });
  });

  it("fingerprints every lifecycle command and environment", () => {
    expect(repositoryRequiresTrust(config)).toBe(true);
    const changed = structuredClone(config);
    changed.appGroups.Infrastructure.stop = {
      argv: ["bun", "run", "infra:down"],
    };
    expect(repositoryCommandFingerprint(changed)).not.toBe(
      repositoryCommandFingerprint(config)
    );
  });

  it("normalizes version-one files into one process-controlled App group", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-legacy-config-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        version: 1,
        stride: 10,
        apps: { api: { basePort: 8000 } },
        env: { API_PORT: "{apps.api.port}" },
      })}\n`
    );
    try {
      expect(loadWorkgroveConfigDocument(path).config).toEqual({
        version: 2,
        setup: { argv: ["npm", "install"] },
        appGroups: {
          Apps: {
            slot: { default: 0, stride: 10 },
            start: { argv: ["npm", "run", "dev"] },
            stop: "process",
            apps: { api: { basePort: 8000 } },
          },
        },
        env: {
          API_PORT: "{appGroups.Apps.apps.api.port}",
          WORKGROVE_SLOT: "{appGroups.Apps.slot}",
        },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects stale saves without overwriting newer changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-config-"));
    const path = join(directory, ".workgrove.json");
    writeFileSync(path, `${JSON.stringify(config)}\n`);
    try {
      const firstRead = loadWorkgroveConfigDocument(path);
      const changed = structuredClone(config);
      changed.appGroups.Apps.apps.Web.basePort = 4000;
      writeFileSync(path, `${JSON.stringify(changed)}\n`);
      expect(() =>
        updateWorkgroveConfig(path, config, firstRead.revision)
      ).toThrow("configuration changed on disk");
      expect(
        loadWorkgroveConfigDocument(path).config.appGroups.Apps.apps.Web
          .basePort
      ).toBe(4000);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
