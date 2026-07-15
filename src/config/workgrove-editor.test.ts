import { describe, expect, it } from "bun:test";

import {
  nextAvailableWorkgroveAppBasePort,
  renameWorkgroveApp,
  resolveWorkgroveAppEndpoints,
} from "./workgrove-editor";
import type { WorkgroveConfig } from "./workgrove-schema";

const config: WorkgroveConfig = {
  version: 1,
  start: { argv: ["dev", "--port", "{apps.api.port}"] },
  apps: {
    api: { basePort: 8000 },
    web: { basePort: 3000 },
  },
};

describe("configuration builder domain operations", () => {
  it("allocates the next available app base port", () => {
    expect(nextAvailableWorkgroveAppBasePort({ api: { basePort: 8000 } })).toBe(
      3000
    );
  });

  it("renames an app and its command templates without changing its base port", () => {
    const renamed = renameWorkgroveApp(config, "api", "backend");
    expect(renamed.apps.api).toBeUndefined();
    expect(renamed.apps.backend).toEqual({ basePort: 8000 });
    expect(renamed.start?.argv).toEqual([
      "dev",
      "--port",
      "{apps.backend.port}",
    ]);
  });

  it("resolves endpoint previews from product port conventions", () => {
    expect(resolveWorkgroveAppEndpoints(config, 2)).toEqual({
      api: { port: 8020, url: "http://localhost:8020" },
      web: { port: 3020, url: "http://localhost:3020" },
    });
  });
});
