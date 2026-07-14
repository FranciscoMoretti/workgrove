import { describe, expect, it } from "bun:test";

import {
  nextAvailableWorkgroveAppPort,
  renameWorkgroveApp,
  resolveWorkgroveAppEndpoints,
  withWorkgroveLaunchMode,
  workgroveAppReferenceCount,
  workgroveLaunchMode,
} from "./workgrove-editor";
import type { WorkgroveConfig } from "./workgrove-schema";

const config: WorkgroveConfig = {
  version: 1,
  apps: {
    api: { port: { base: 8000 } },
    web: {
      exports: { API_URL: "{apps.api.url}" },
      port: { offset: 1 },
      start: { argv: ["bun", "dev", "--api={apps.api.port}"] },
    },
  },
  control: {
    setup: { argv: ["echo", "{apps.api.url}"] },
  },
  ports: { base: 4000, slotStride: 10 },
  slot: { default: 0, env: "WORKGROVE_SLOT" },
  url: "http://localhost:{port}",
};

describe("configuration builder domain operations", () => {
  it("allocates a lane that cannot collide with a custom base", () => {
    expect(
      nextAvailableWorkgroveAppPort(
        { api: { port: { base: 8000 } } },
        config.ports
      )
    ).toEqual({ offset: 1 });
  });

  it("renames an app and every template reference to it", () => {
    expect(workgroveAppReferenceCount(config, "api")).toBe(3);
    const renamed = renameWorkgroveApp(config, "api", "backend");
    expect(renamed.apps.api).toBeUndefined();
    expect(renamed.apps.web.exports?.API_URL).toBe("{apps.backend.url}");
    expect(renamed.apps.web.start?.argv[2]).toBe("--api={apps.backend.port}");
    expect(renamed.control?.setup?.argv[1]).toBe("{apps.backend.url}");
  });

  it("switches launch strategies without leaving ambiguous commands", () => {
    const aggregate = withWorkgroveLaunchMode(config, "aggregate");
    expect(workgroveLaunchMode(aggregate)).toBe("aggregate");
    expect(aggregate.apps.web.start).toBeUndefined();

    const perApp = withWorkgroveLaunchMode(aggregate, "per-app");
    expect(workgroveLaunchMode(perApp)).toBe("per-app");
    expect(perApp.control?.start).toBeUndefined();
  });

  it("uses the executable's shared endpoint resolver for previews", () => {
    expect(resolveWorkgroveAppEndpoints(config, 2)).toEqual({
      api: { port: 8020, url: "http://localhost:8020" },
      web: { port: 4021, url: "http://localhost:4021" },
    });
  });
});
