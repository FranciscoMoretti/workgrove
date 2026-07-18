import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { DetailsPanel } from "./details-panel";

const LINKED_CODE_PORT = /<a[^>]*><code[^>]*>3000<\/code><\/a>/;
const STOPPED_CODE_PORT = /<code class="[^"]*font-mono[^"]*"[^>]*>3002<\/code>/;

const worktree: WorktreeSnapshot = {
  appLabel: "App",
  apps: [],
  appGroups: [
    {
      apps: [],
      health: "not-running",
      name: "Apps",
      processRunning: false,
      slot: 0,
      slotState: "assigned",
      stop: "process",
    },
  ],
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

function renderDetails(value: WorktreeSnapshot): string {
  return renderToStaticMarkup(
    createElement(DetailsPanel, {
      actionBlocked: false,
      actionPending: false,
      clearPending: false,
      commandActions: {
        onRestart: () => undefined,
        onSetup: () => undefined,
        onStart: () => undefined,
        onStop: () => undefined,
      },
      error: null,
      loading: false,
      logs: [],
      onClearLogs: () => undefined,
      onClose: () => undefined,
      onDelete: () => undefined,
      onInspect: () => undefined,
      onRetryLogs: () => undefined,
      onToggleApps: () => undefined,
      worktreeActionPending: false,
      worktree: value,
    })
  );
}

describe("details panel", () => {
  it("presents transient log transport errors as a recoverable state", () => {
    const markup = renderToStaticMarkup(
      createElement(DetailsPanel, {
        actionBlocked: false,
        actionPending: false,
        clearPending: false,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        error: new Error("Failed to fetch"),
        loading: false,
        logs: [],
        onClearLogs: () => undefined,
        onClose: () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRetryLogs: () => undefined,
        onToggleApps: () => undefined,
        worktreeActionPending: false,
        worktree,
      })
    );
    expect(markup).toContain("Logs temporarily unavailable");
    expect(markup).not.toContain("Failed to fetch");
    expect(markup).toContain("Retry now");
  });

  it("uses the same code typography for linked and stopped app ports", () => {
    const markup = renderDetails({
      ...worktree,
      apps: [
        {
          id: "chat",
          label: "Chat",
          listening: true,
          open: true,
          ownership: "owned",
          port: 3000,
          probe: "tcp",
          required: true,
          url: "http://localhost:3000",
        },
        {
          id: "site",
          label: "Site",
          listening: false,
          open: true,
          ownership: "none",
          port: 3002,
          probe: "tcp",
          required: true,
          url: "http://localhost:3002",
        },
      ],
    });

    expect(markup).toMatch(LINKED_CODE_PORT);
    expect(markup).toMatch(STOPPED_CODE_PORT);
  });

  it("uses the shared scroll area for managed logs", () => {
    const markup = renderDetails(worktree);

    expect(markup).toContain('data-slot="scroll-area"');
    expect(markup).toContain('data-slot="scroll-area-viewport"');
  });
});
