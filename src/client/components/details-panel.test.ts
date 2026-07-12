import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { DetailsPanel } from "./details-panel";

const worktree: WorktreeSnapshot = {
  appLabel: "App",
  apps: [],
  branch: "main",
  health: "not-running",
  id: "worktree",
  isMain: true,
  name: "project",
  path: "/tmp/project",
  processRunning: false,
  setupState: "idle",
  slot: 0,
  slotState: "assigned",
};

describe("details panel", () => {
  it("presents transient log transport errors as a recoverable state", () => {
    const markup = renderToStaticMarkup(
      createElement(DetailsPanel, {
        actionPending: false,
        clearPending: false,
        error: new Error("Failed to fetch"),
        loading: false,
        logs: [],
        onClearLogs: () => undefined,
        onClose: () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestart: () => undefined,
        onRetryLogs: () => undefined,
        onToggleApps: () => undefined,
        worktree,
      })
    );
    expect(markup).toContain("Logs temporarily unavailable");
    expect(markup).not.toContain("Failed to fetch");
    expect(markup).toContain("Retry now");
  });
});
