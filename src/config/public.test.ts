import { describe, expect, it } from "bun:test";
import {
  resolveWorkgroveRuntime,
  type WorkgroveConfig,
} from "workgrove/config";

describe("public config contract", () => {
  it("resolves repository tooling ports through the package subpath", () => {
    const config: WorkgroveConfig = {
      version: 1,
      apps: { web: { offset: 2 } },
      range: { base: 4000, stride: 10 },
      slot: { default: 0, env: "WORKGROVE_SLOT" },
      url: "http://localhost:{port}",
    };

    expect(
      resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "3" }).apps.web.port
    ).toBe(4032);
  });
});
