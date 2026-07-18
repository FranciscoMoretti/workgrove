import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { WorktreeTable } from "./worktree-table";

const MONO_LINKED_PORT =
  /<a[^>]*><code class="[^"]*font-mono[^"]*"[^>]*>3000<\/code><\/a>/;
const MONO_STOPPED_PORT =
  /<code[^>]*class="[^"]*font-mono[^"]*"[^>]*>3002<\/code>/;
const PRODUCT_GROUP_WITH_ENDPOINT =
  /data-app-group="Product Apps"[^>]*>[\s\S]*?3000/;
const INFRASTRUCTURE_GROUP_WITH_ENDPOINT =
  /data-app-group="Infrastructure"[^>]*>[\s\S]*?5432/;

const worktree: WorktreeSnapshot = {
  appLabel: "App",
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
  appGroups: [],
  branch: "main",
  health: "partially-running",
  id: "worktree",
  isMain: true,
  name: "project",
  path: "/tmp/project",
  processRunning: true,
  setupState: "idle",
  slot: 0,
  slotState: "assigned",
};

describe("worktree table", () => {
  it("keeps each group's controls and endpoints in one fluid console", () => {
    const withGroups = {
      ...worktree,
      appGroups: [
        {
          apps: worktree.apps,
          health: worktree.health,
          name: "Product Apps",
          processRunning: true,
          slot: 0,
          slotState: "assigned" as const,
          stop: "process" as const,
        },
        {
          apps: [
            {
              ...worktree.apps[0],
              id: "database",
              label: "Postgres",
              port: 5432,
              url: "http://localhost:5432",
            },
          ],
          health: "running" as const,
          name: "Infrastructure",
          processRunning: false,
          slot: 0,
          slotState: "assigned" as const,
          stop: "command" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        actionPending: () => false,
        appGroupSlots: { Infrastructure: [], "Product Apps": [] },
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onSetSlot: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktrees: [withGroups],
      })
    );

    expect(markup).not.toContain(">Endpoints<");
    expect(markup).toContain('data-slot="app-group-grid"');
    expect(markup).toContain('data-app-group="Product Apps"');
    expect(markup).toContain('data-app-group="Infrastructure"');
    expect(markup).toMatch(PRODUCT_GROUP_WITH_ENDPOINT);
    expect(markup).toMatch(INFRASTRUCTURE_GROUP_WITH_ENDPOINT);
  });

  it("renders every app port in the monospace font", () => {
    const withGroup = {
      ...worktree,
      appGroups: [
        {
          apps: worktree.apps,
          health: worktree.health,
          name: "Product Apps",
          processRunning: true,
          slot: 0,
          slotState: "assigned" as const,
          stop: "process" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        actionPending: () => false,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        appGroupSlots: { "Product Apps": [] },
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onSetSlot: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktrees: [withGroup],
      })
    );

    expect(markup).toMatch(MONO_LINKED_PORT);
    expect(markup).toMatch(MONO_STOPPED_PORT);
    expect(markup).not.toContain("lucide-chevron-right");
  });

  it("exposes running health to the status color styles", () => {
    const running = {
      ...worktree,
      appGroups: [
        {
          apps: worktree.apps,
          health: "running" as const,
          name: "Product Apps",
          processRunning: true,
          slot: 0,
          slotState: "assigned" as const,
          stop: "process" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        actionPending: () => false,
        appGroupSlots: { "Product Apps": [] },
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onSetSlot: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktrees: [running],
      })
    );

    expect(markup).toContain('data-health="running"');
  });
});
