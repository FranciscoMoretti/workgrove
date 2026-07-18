import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { WorktreeTable } from "./worktree-table";

const MONO_LINKED_PORT =
  /<a[^>]*><code class="[^"]*font-mono[^"]*"[^>]*>3000<\/code><\/a>/;
const MONO_STOPPED_PORT =
  /<code[^>]*class="[^"]*font-mono[^"]*"[^>]*>3002<\/code>/;

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
});
