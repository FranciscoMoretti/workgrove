import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "./workgrove-json-schema";
import {
  canonicalizeWorkgroveConfig,
  maximumWorkgroveSlot,
  WorkgroveConfigSchema,
  workgroveSlotsHavePortCollision,
} from "./workgrove-schema";

const validConfig = {
  version: 1,
  apps: { web: { port: { base: 3000 } } },
  ports: { slotStride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT" },
  url: "http://localhost:{port}",
} as const;

describe("shared Workgrove schema", () => {
  it("reports cross-field errors at form-compatible paths", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        api: { port: { base: 3000 }, start: { argv: ["bun", "api"] } },
        web: { port: { base: 3000 } },
      },
      control: { start: { argv: ["bun", "dev"] } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "control",
        "start",
      ]);
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "apps",
        "web",
        "port",
        "base",
      ]);
    }
  });

  it("requires an explicit slot-zero base port for every app", () => {
    expect(
      WorkgroveConfigSchema.parse({
        ...validConfig,
        apps: {
          api: { port: { base: 8000 } },
          web: { port: { base: 3000 } },
        },
      }).apps
    ).toEqual({
      api: { port: { base: 8000 } },
      web: { port: { base: 3000 } },
    });
    expect(
      WorkgroveConfigSchema.safeParse({
        ...validConfig,
        apps: { api: { port: { offset: 0 } } },
      }).success
    ).toBe(false);
    expect(
      WorkgroveConfigSchema.safeParse({
        ...validConfig,
        ports: { base: 4000, slotStride: 10 },
      }).success
    ).toBe(false);
  });

  it("limits slots using the highest app-specific slot-zero port", () => {
    const config = WorkgroveConfigSchema.parse({
      ...validConfig,
      apps: {
        api: { port: { base: 8000 } },
        web: { port: { base: 3000 } },
      },
    });
    expect(maximumWorkgroveSlot(config)).toBe(5753);
  });

  it("detects collisions from the exact pair of assigned worktree slots", () => {
    const config = WorkgroveConfigSchema.parse({
      ...validConfig,
      apps: {
        web: { port: { base: 3000 } },
        api: { port: { base: 8000 } },
      },
    });
    expect(workgroveSlotsHavePortCollision(config, 0, 1)).toBe(false);
    expect(workgroveSlotsHavePortCollision(config, 0, 500)).toBe(true);
  });

  it("rejects templates that reference an unknown app", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        web: {
          exports: { API_URL: "{apps.api.url}" },
          port: { base: 3000 },
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "apps",
        "web",
        "exports",
        "API_URL",
      ]);
    }
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

  it("canonicalizes optional editor containers in the shared config module", () => {
    expect(
      canonicalizeWorkgroveConfig({
        ...validConfig,
        apps: { web: { control: {}, exports: {}, port: { base: 3000 } } },
        control: {},
      })
    ).toEqual(validConfig);
  });
});
