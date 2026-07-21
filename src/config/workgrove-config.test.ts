import { describe, expect, it } from "bun:test";

import { resolveStartCommand } from "./workgrove-config";
import type { WorkgroveConfig } from "./workgrove-schema";

describe("Workgrove App group environment", () => {
  it("renders one dynamically assigned HTTP endpoint into the trusted command", () => {
    const config: WorkgroveConfig = {
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        web: {
          apps: { site: { protocol: "http", readiness: "tcp" } },
          env: {
            APP_HOST: "{apps.site.host}",
            APP_PORT: "{apps.site.port}",
            APP_URL: "{apps.site.url}",
          },
          start: { argv: ["bun", "run", "dev", "--port", "{apps.site.port}"] },
          stop: "process",
        },
      },
    };

    expect(
      resolveStartCommand(config, "web", {
        web: {
          id: "web",
          apps: {
            site: {
              directUrl: "http://127.0.0.1:43127",
              host: "127.0.0.1",
              port: 43_127,
              url: "http://site.main.example.localhost:1355",
            },
          },
        },
      })
    ).toEqual({
      argv: ["bun", "run", "dev", "--port", "43127"],
      env: {
        APP_HOST: "127.0.0.1",
        APP_PORT: "43127",
        APP_URL: "http://site.main.example.localhost:1355",
      },
    });
  });

  it("renders another group's stable HTTP URL without its active backing port", () => {
    const config: WorkgroveConfig = {
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        api: {
          apps: { service: { protocol: "http", readiness: "tcp" } },
          start: { argv: ["bun", "run", "api"] },
          stop: "process",
        },
        web: {
          apps: { site: { protocol: "http", readiness: "tcp" } },
          env: {
            API_URL: "{appGroups.api.apps.service.url}",
            WEB_PORT: "{apps.site.port}",
          },
          start: { argv: ["bun", "run", "web"] },
          stop: "process",
        },
      },
    };

    expect(
      resolveStartCommand(config, "web", {
        api: {
          id: "api",
          apps: {
            service: { url: "http://service.main.repo.localhost:1355" },
          },
        },
        web: {
          id: "web",
          apps: { site: { host: "127.0.0.1", port: 49_152 } },
        },
      }).env
    ).toEqual({
      API_URL: "http://service.main.repo.localhost:1355",
      WEB_PORT: "49152",
    });
  });
});
