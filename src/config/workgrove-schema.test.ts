import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "./workgrove-json-schema";
import {
  canonicalizeWorkgroveConfig,
  maximumWorkgroveSlot,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  workgroveSlotsHavePortCollision,
} from "./workgrove-schema";

const validConfig = {
  version: 1,
  setup: { argv: ["bun", "install"] },
  start: { argv: ["bun", "run", "dev"] },
  apps: {
    api: { basePort: 8000 },
    web: { basePort: 3000 },
  },
} satisfies WorkgroveConfig;

describe("shared Workgrove schema", () => {
  it("accepts repository setup, one start command, and app base ports", () => {
    expect(WorkgroveConfigSchema.parse(validConfig)).toEqual(validConfig);
    expect(
      WorkgroveConfigSchema.safeParse({
        ...validConfig,
        control: { start: { argv: ["bun", "dev"] } },
      }).success
    ).toBe(false);
  });

  it("rejects duplicate ports and colliding automatic environment names", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        "api-v1": { basePort: 3000 },
        api_v1: { basePort: 3000 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "apps",
        "api_v1",
        "basePort",
      ]);
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "apps",
        "api_v1",
      ]);
    }
  });

  it("limits slots using the highest app base port", () => {
    expect(maximumWorkgroveSlot(WorkgroveConfigSchema.parse(validConfig))).toBe(
      5753
    );
  });

  it("detects collisions from exact computed app ports", () => {
    const config = WorkgroveConfigSchema.parse(validConfig);
    expect(workgroveSlotsHavePortCollision(config, 0, 1)).toBe(false);
    expect(workgroveSlotsHavePortCollision(config, 0, 500)).toBe(true);
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

  it("canonicalizes through an independent configuration value", () => {
    const parsed = WorkgroveConfigSchema.parse(validConfig);
    const canonical = canonicalizeWorkgroveConfig(parsed);
    expect(canonical).toEqual(parsed);
    expect(canonical).not.toBe(parsed);
  });
});
