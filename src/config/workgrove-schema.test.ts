import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "./workgrove-json-schema";
import {
  canonicalizeWorkgroveConfig,
  maximumWorkgroveSlot,
  WorkgroveConfigSchema,
} from "./workgrove-schema";

const validConfig = {
  version: 1,
  apps: { web: { port: { offset: 0 } } },
  ports: { base: 4000, slotStride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT" },
  url: "http://localhost:{port}",
} as const;

describe("shared Workgrove schema", () => {
  it("reports cross-field errors at form-compatible paths", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        api: { port: { base: 4000 }, start: { argv: ["bun", "api"] } },
        web: { port: { offset: 0 } },
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
      ]);
    }
  });

  it("accepts either a range offset or a custom slot-zero base port", () => {
    expect(
      WorkgroveConfigSchema.parse({
        ...validConfig,
        apps: {
          api: { port: { base: 8000 } },
          web: { port: { offset: 1 } },
        },
      }).apps
    ).toEqual({
      api: { port: { base: 8000 } },
      web: { port: { offset: 1 } },
    });
    expect(
      WorkgroveConfigSchema.safeParse({
        ...validConfig,
        apps: { api: { port: { base: 8000, offset: 0 } } },
      }).success
    ).toBe(false);
  });

  it("limits slots using the highest app-specific slot-zero port", () => {
    const config = WorkgroveConfigSchema.parse({
      ...validConfig,
      apps: {
        api: { port: { base: 8000 } },
        web: { port: { offset: 1 } },
      },
    });
    expect(maximumWorkgroveSlot(config)).toBe(5753);
  });

  it("rejects app port lanes that collide across worktree slots", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        api: { port: { base: 8000 } },
        worker: { port: { base: 8010 } },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Port lane collides");
    }
  });

  it("rejects templates that reference an unknown app", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        web: {
          exports: { API_URL: "{apps.api.url}" },
          port: { offset: 0 },
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
        apps: { web: { control: {}, exports: {}, port: { offset: 0 } } },
        control: {},
      })
    ).toEqual(validConfig);
  });
});
