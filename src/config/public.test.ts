import { describe, expect, it } from "bun:test";
import {
  resolveWorkgroveAppGroup,
  type WorkgroveConfig,
} from "workgrove/config";

describe("public config contract", () => {
  it("resolves repository app ports through the package subpath", () => {
    const config: WorkgroveConfig = {
      version: 2,
      setup: { argv: ["npm", "install"] },
      appGroups: {
        Apps: {
          slot: { default: 0, stride: 10 },
          start: { argv: ["npm", "run", "dev"] },
          stop: "process",
          apps: { web: { basePort: 3000 } },
        },
      },
    };
    expect(resolveWorkgroveAppGroup(config, "Apps", 3).apps.web.port).toBe(
      3030
    );
  });
});
