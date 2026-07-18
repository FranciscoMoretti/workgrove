import { describe, expect, it } from "bun:test";

import {
  addWorkgroveEnvironment,
  deleteWorkgroveEnvironment,
  nextAvailableWorkgroveAppBasePort,
  renameWorkgroveApp,
  renameWorkgroveAppGroup,
  renameWorkgroveEnvironment,
  resolveWorkgroveAppEndpoints,
} from "./workgrove-editor";
import type { WorkgroveConfig } from "./workgrove-schema";

const config: WorkgroveConfig = {
  version: 2,
  setup: { argv: ["npm", "install"] },
  appGroups: {
    "Product Apps": {
      slot: { default: 0, stride: 10 },
      start: { argv: ["npm", "run", "dev"] },
      stop: "process",
      apps: { api: { basePort: 8000 }, web: { basePort: 3000 } },
    },
  },
  env: {
    API_URL: "{appGroups.Product Apps.apps.api.url}",
    API_PORT: "{appGroups.Product Apps.apps.api.port}",
  },
};

describe("configuration builder domain operations", () => {
  it("allocates the next available app base port", () => {
    expect(nextAvailableWorkgroveAppBasePort({ api: { basePort: 8000 } })).toBe(
      3000
    );
  });

  it("renames groups and apps without normalizing their names", () => {
    const renamedApp = renameWorkgroveApp(
      config,
      "Product Apps",
      "api",
      "Backend API"
    );
    expect(renamedApp.appGroups["Product Apps"].apps["Backend API"]).toEqual({
      basePort: 8000,
    });
    expect(renamedApp.env?.API_PORT).toBe(
      "{appGroups.Product Apps.apps.Backend API.port}"
    );
    const renamedGroup = renameWorkgroveAppGroup(
      renamedApp,
      "Product Apps",
      "Local Product"
    );
    expect(renamedGroup.env?.API_PORT).toBe(
      "{appGroups.Local Product.apps.Backend API.port}"
    );
  });

  it("resolves endpoint previews", () => {
    expect(
      resolveWorkgroveAppEndpoints(config, "Product Apps", 2).web.port
    ).toBe(3020);
  });

  it("adds, renames, and deletes environment entries", () => {
    const added = addWorkgroveEnvironment({ ...config, env: undefined });
    expect(added.env?.APP_PORT).toBe("{appGroups.Product Apps.apps.api.port}");
    const renamed = renameWorkgroveEnvironment(added, "APP_PORT", "API_PORT");
    expect(deleteWorkgroveEnvironment(renamed, "API_PORT").env).toEqual({});
  });
});
