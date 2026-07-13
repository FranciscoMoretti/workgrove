import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "./workgrove-json-schema";
import {
  canonicalizeWorkgroveConfig,
  WorkgroveConfigSchema,
} from "./workgrove-schema";

const validConfig = {
  version: 1,
  apps: { web: { offset: 0 } },
  range: { base: 4000, stride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT" },
  url: "http://localhost:{port}",
} as const;

describe("shared Workgrove schema", () => {
  it("reports cross-field errors at form-compatible paths", () => {
    const result = WorkgroveConfigSchema.safeParse({
      ...validConfig,
      apps: {
        api: { offset: 0, start: { argv: ["bun", "api"] } },
        web: { offset: 0 },
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
        "offset",
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
        apps: { web: { control: {}, exports: {}, offset: 0 } },
        control: {},
      })
    ).toEqual(validConfig);
  });
});
