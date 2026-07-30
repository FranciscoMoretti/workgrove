import { describe, expect, it } from "bun:test";

import type { AppEndpointSnapshot } from "../../controller/workspace-snapshot";
import {
  appGroupDisplayStatus,
  worktreeDisplayStatus,
} from "./app-group-status";

const readyHttpApp: AppEndpointSnapshot = {
  directUrl: "http://127.0.0.1:3000",
  id: "web",
  label: "Web",
  listening: true,
  open: true,
  ownership: "owned",
  port: 3000,
  protocol: "http",
  readiness: "ready",
  routeState: "active",
  url: "http://web.main.repo.localhost",
};

describe("App-group display status", () => {
  it("keeps process, readiness, and routing evidence in canonical summaries", () => {
    expect(
      appGroupDisplayStatus({
        apps: [readyHttpApp],
        health: "running",
        processRunning: true,
      })
    ).toBe("running");
    expect(
      appGroupDisplayStatus({
        apps: [{ ...readyHttpApp, readiness: "unready" }],
        health: "partially-running",
        processRunning: true,
      })
    ).toBe("partial");
    expect(
      appGroupDisplayStatus({
        apps: [{ ...readyHttpApp, open: false, routeState: "unavailable" }],
        health: "running",
        processRunning: true,
      })
    ).toBe("partial");
    expect(
      appGroupDisplayStatus({
        apps: [
          {
            ...readyHttpApp,
            listening: false,
            open: false,
            readiness: "unready",
            routeState: "inactive",
            url: null,
          },
        ],
        health: "not-running",
        processRunning: false,
      })
    ).toBe("stopped");
  });

  it("keeps Setup state separate from App-group status", () => {
    expect(
      worktreeDisplayStatus({
        appGroups: [],
        health: "not-running",
        processRunning: false,
        setupState: "failed",
      })
    ).toBe("setup-failed");
    expect(
      worktreeDisplayStatus({
        appGroups: [],
        health: "not-running",
        processRunning: false,
        setupState: "running",
      })
    ).toBe("setting-up");
  });

  it("projects route errors and partial readiness as partial status", () => {
    expect(
      worktreeDisplayStatus({
        appGroups: [
          {
            apps: [{ ...readyHttpApp, open: false, routeState: "unavailable" }],
            health: "running",
            processRunning: true,
          },
        ],
        health: "running",
        processRunning: true,
        setupState: "idle",
      })
    ).toBe("partial");
    expect(
      worktreeDisplayStatus({
        appGroups: [
          {
            apps: [{ ...readyHttpApp, readiness: "unready" }],
            health: "partially-running",
            processRunning: true,
          },
        ],
        health: "partially-running",
        processRunning: true,
        setupState: "idle",
      })
    ).toBe("partial");
  });
});
