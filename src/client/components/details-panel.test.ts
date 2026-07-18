import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CodexTaskSnapshot } from "../../codex/codex-integration";
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

function renderDetails(
  value: WorktreeSnapshot,
  codex: {
    codexDiscoveryUnavailable?: boolean;
    codexLoading?: boolean;
    codexTasks?: CodexTaskSnapshot[];
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(DetailsPanel, {
      actionBlocked: false,
      actionPending: false,
      clearPending: false,
      ...codex,
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

  it("keeps Codex task links and context-sharing state inside the existing inspector", () => {
    const markup = renderDetails(worktree, {
      codexTasks: [
        {
          activity: {
            observedAt: "2026-07-18T09:59:00.000Z",
            state: "working",
            subagentCount: 1,
          },
          contextSharedAt: "2026-07-18T10:00:00.000Z",
          createdAt: "2026-07-18T09:00:00.000Z",
          id: "task/with spaces",
          title: "Review the task integration",
          updatedAt: "2026-07-18T10:01:00.000Z",
        },
      ],
    });

    expect(markup).toContain("Codex tasks");
    expect(markup).toContain("Context shared");
    expect(markup).toContain("codex://new?path=%2Ftmp%2Fproject");
    expect(markup).toContain("codex://threads/task%2Fwith%20spaces");
  });

  it("keeps New task available when discovery is unavailable", () => {
    const markup = renderDetails(worktree, {
      codexDiscoveryUnavailable: true,
    });

    expect(markup).toContain("Task discovery is temporarily unavailable");
    expect(markup).toContain("New task");
  });
});
