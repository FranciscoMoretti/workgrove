import { describe, expect, it } from "bun:test";
import {
  resolveWorkgroveAppGroup,
  type WorkgroveConfig,
} from "workgrove/config";

describe("public config contract", () => {
  it("resolves repository app ports through the package subpath", () => {
    const config: WorkgroveConfig = {
      version: 1,
      apps: { web: { basePort: 3000 } },
    };
    expect(
      resolveWorkgroveAppGroup(config, { WORKGROVE_SLOT: "3" }).apps.web.port
    ).toBe(3030);
  });
});
