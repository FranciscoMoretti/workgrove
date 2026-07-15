import { describe, expect, it } from "bun:test";

import {
  addWorkgroveEnvironment,
  deleteWorkgroveEnvironment,
  nextAvailableWorkgroveAppBasePort,
  renameWorkgroveApp,
  renameWorkgroveEnvironment,
  resolveWorkgroveAppEndpoints,
} from "./workgrove-editor";
import type { WorkgroveConfig } from "./workgrove-schema";

const config: WorkgroveConfig = {
  version: 1,
  stride: 10,
  setup: { argv: ["npm", "install"] },
  start: { argv: ["npm", "run", "dev"] },
  apps: {
    api: { basePort: 8000 },
    web: { basePort: 3000 },
  },
  env: {
    API_URL: "{apps.api.url}",
    API_PORT: "{apps.api.port}",
  },
};

describe("configuration builder domain operations", () => {
  it("allocates the next available app base port", () => {
    expect(nextAvailableWorkgroveAppBasePort({ api: { basePort: 8000 } })).toBe(
      3000
    );
  });

  it("renames an app without changing its base port", () => {
    const renamed = renameWorkgroveApp(config, "api", "backend");
    expect(renamed.apps.api).toBeUndefined();
    expect(renamed.apps.backend).toEqual({ basePort: 8000 });
    expect(renamed.env).toEqual({
      API_URL: "{apps.backend.url}",
      API_PORT: "{apps.backend.port}",
    });
  });

  it("resolves endpoint previews from product port conventions", () => {
    expect(resolveWorkgroveAppEndpoints(config, 2)).toEqual({
      api: { port: 8020, url: "http://localhost:8020" },
      web: { port: 3020, url: "http://localhost:3020" },
    });
  });

  it("adds, renames, and deletes repository environment entries", () => {
    const added = addWorkgroveEnvironment({ ...config, env: undefined });
    expect(added.env).toEqual({ APP_PORT: "{apps.api.port}" });
    const renamed = renameWorkgroveEnvironment(added, "APP_PORT", "API_PORT");
    expect(renamed.env).toEqual({ API_PORT: "{apps.api.port}" });
    expect(deleteWorkgroveEnvironment(renamed, "API_PORT").env).toEqual({});
  });
});
