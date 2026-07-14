import { describe, expect, it } from "bun:test";
import {
  resolveWorkgroveRuntime,
  type WorkgroveConfig,
} from "workgrove/config";

describe("public config contract", () => {
  it("resolves repository tooling ports through the package subpath", () => {
    const config: WorkgroveConfig = {
      version: 1,
      apps: { web: { port: { base: 3000 } } },
      ports: { slotStride: 10 },
      slot: { default: 0, env: "WORKGROVE_SLOT" },
      url: "http://localhost:{port}",
    };

    expect(
      resolveWorkgroveRuntime(config, { WORKGROVE_SLOT: "3" }).apps.web.port
    ).toBe(3030);
  });
});
