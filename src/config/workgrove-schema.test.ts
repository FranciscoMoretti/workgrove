import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "./workgrove-json-schema";
import {
  cloneWorkgroveConfig,
  maximumWorkgroveAppGroupSlot,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  workgroveAppGroupSlotsHavePortCollision,
} from "./workgrove-schema";

const validConfig = {
  version: 2,
  setup: { argv: ["bun", "install"] },
  appGroups: {
    Apps: {
      slot: { default: 0, stride: 25 },
      start: { argv: ["bun", "run", "dev"] },
      stop: "process",
      apps: {
        API: { basePort: 8000 },
        Web: { basePort: 3000 },
      },
    },
    "Local Infrastructure": {
      slot: { default: 0, stride: 100 },
      start: { argv: ["bun", "run", "infra:start"] },
      stop: { argv: ["bun", "run", "infra:stop"] },
      apps: { Postgres: { basePort: 5432 } },
    },
  },
  env: {
    API_PORT: "{appGroups.Apps.apps.API.port}",
    DB_PORT: "{appGroups.Local Infrastructure.apps.Postgres.port}",
  },
} satisfies WorkgroveConfig;

describe("shared Workgrove schema", () => {
  it("accepts named App groups with process and command Stop strategies", () => {
    expect(WorkgroveConfigSchema.parse(validConfig)).toEqual(validConfig);
  });

  it("accepts arbitrary non-empty group and App names", () => {
    expect(
      WorkgroveConfigSchema.safeParse({
        ...validConfig,
        env: undefined,
        appGroups: {
          "UPPER case & spaces": {
            ...validConfig.appGroups.Apps,
            apps: { "API / Web": { basePort: 8000 } },
          },
        },
      }).success
    ).toBe(true);
  });

  it("requires setup and at least one App group", () => {
    expect(
      WorkgroveConfigSchema.safeParse({ ...validConfig, setup: undefined })
        .success
    ).toBe(false);
    expect(
      WorkgroveConfigSchema.safeParse({ ...validConfig, appGroups: {} }).success
    ).toBe(false);
  });

  it("rejects duplicate ports within an App group", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      appGroups: {
        Apps: {
          ...validConfig.appGroups.Apps,
          apps: {
            API: { basePort: 3000 },
            Web: { basePort: 3000 },
          },
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "appGroups",
        "Apps",
        "apps",
        "Web",
        "basePort",
      ]);
    }
  });

  it("rejects environment templates that reference unknown values", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      env: { UNKNOWN_PORT: "{appGroups.Apps.apps.Missing.port}" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "env",
        "UNKNOWN_PORT",
      ]);
    }
  });

  it("limits slots per App group using its highest base port", () => {
    expect(maximumWorkgroveAppGroupSlot(validConfig.appGroups.Apps)).toBe(2301);
  });

  it("detects exact computed collisions within an App group", () => {
    const group = validConfig.appGroups.Apps;
    expect(workgroveAppGroupSlotsHavePortCollision(group, 0, 1)).toBe(false);
    expect(workgroveAppGroupSlotsHavePortCollision(group, 0, 200)).toBe(true);
  });

  it("keeps the published JSON Schema generated from the Zod schema", () => {
    const path = join(
      import.meta.dirname,
      "..",
      "..",
      "schema",
      "workgrove.schema.json"
    );
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(
      workgroveJsonSchema()
    );
  });

  it("clones to an independent configuration value", () => {
    const parsed = WorkgroveConfigSchema.parse(validConfig);
    const clone = cloneWorkgroveConfig(parsed);
    expect(clone).toEqual(parsed);
    expect(clone).not.toBe(parsed);
  });
});
