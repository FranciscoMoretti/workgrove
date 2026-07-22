import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";
import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { WorktreeTable } from "./worktree-table";

const LINKED_FRIENDLY_URL = /<a[^>]*>chat\.project\.repo\.localhost:1355<\/a>/;
const MONO_STOPPED_PORT =
  /<code[^>]*class="[^"]*font-mono[^"]*"[^>]*>3002<\/code>/;
const PRODUCT_GROUP_WITH_ENDPOINT =
  /data-app-group="Product Apps"[^>]*>[\s\S]*?chat\.project\.repo\.localhost:1355/;
const INFRASTRUCTURE_GROUP_WITH_ENDPOINT =
  /data-app-group="Infrastructure"[^>]*>[\s\S]*?5432/;

const worktree: WorktreeSnapshot = {
  appLabel: "App",
  apps: [
    {
      id: "chat",
      label: "Chat",
      directUrl: "http://127.0.0.1:3000",
      listening: true,
      open: true,
      ownership: "owned",
      port: 3000,
      protocol: "http",
      readiness: "ready",
      routeState: "active",
      url: "http://chat.project.repo.localhost:1355",
    },
    {
      id: "site",
      label: "Site",
      directUrl: "http://127.0.0.1:3002",
      listening: false,
      open: false,
      ownership: "none",
      port: 3002,
      protocol: "http",
      readiness: "unready",
      routeState: "inactive",
      url: null,
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
};

describe("worktree table", () => {
  it("keeps each group's controls and endpoints in one fluid console", () => {
    const withGroups = {
      ...worktree,
      appGroups: [
        {
          apps: worktree.apps,
          health: worktree.health,
          id: "product",
          instance: {
            id: "product-main",
            mode: "per-worktree" as const,
            name: "main",
          },
          instances: [{ id: "product-main", name: "main", running: true }],
          name: "Product Apps",
          processRunning: true,
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
          id: "infrastructure",
          instance: {
            id: "infra-main",
            mode: "selectable" as const,
            name: "Default",
          },
          instances: [{ id: "infra-main", name: "Default", running: true }],
          name: "Infrastructure",
          processRunning: false,
          stop: "command" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: () => false,
        appGroupActionPending: () => false,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => false,
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
          id: "product",
          instance: {
            id: "product-main",
            mode: "per-worktree" as const,
            name: "main",
          },
          instances: [{ id: "product-main", name: "main", running: true }],
          name: "Product Apps",
          processRunning: true,
          stop: "process" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: () => false,
        appGroupActionPending: () => false,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => false,
        worktrees: [withGroup],
      })
    );

    expect(markup).toMatch(LINKED_FRIENDLY_URL);
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
          id: "product",
          instance: {
            id: "product-main",
            mode: "per-worktree" as const,
            name: "main",
          },
          instances: [{ id: "product-main", name: "main", running: true }],
          name: "Product Apps",
          processRunning: true,
          stop: "process" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: () => false,
        appGroupActionPending: () => false,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => false,
        worktrees: [running],
      })
    );

    expect(markup).toContain('data-health="running"');
  });

  it("shows pending state only for the affected app group", () => {
    const withGroups = {
      ...worktree,
      appGroups: [
        {
          apps: [worktree.apps[0]],
          health: "running" as const,
          id: "product",
          instance: {
            id: "product-main",
            mode: "per-worktree" as const,
            name: "main",
          },
          instances: [{ id: "product-main", name: "main", running: true }],
          name: "Product Apps",
          processRunning: true,
          stop: "process" as const,
        },
        {
          apps: [worktree.apps[1]],
          health: "not-running" as const,
          id: "website",
          instance: {
            id: "website-main",
            mode: "per-worktree" as const,
            name: "main",
          },
          instances: [{ id: "website-main", name: "main", running: false }],
          name: "Website",
          processRunning: false,
          stop: "process" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: (_worktreeId: string, appGroupName: string) =>
          appGroupName === "product",
        appGroupActionPending: (_worktreeId: string, appGroupName: string) =>
          appGroupName === "product",
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => true,
        worktrees: [withGroups],
      })
    );
    const productStart = markup.indexOf('data-app-group="Product Apps"');
    const websiteStart = markup.indexOf('data-app-group="Website"');
    const productMarkup = markup.slice(productStart, websiteStart);
    const websiteMarkup = markup.slice(websiteStart);

    expect(productMarkup).toContain('aria-label="Loading"');
    expect(websiteMarkup).not.toContain('aria-label="Loading"');
  });

  it("keeps task discovery failure compact in the table", () => {
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: () => false,
        appGroupActionPending: () => false,
        codexAvailability: "unavailable",
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => false,
        worktrees: [worktree],
      })
    );

    expect(markup).toContain(">Codex<");
    expect(markup).toContain("Unavailable");
  });

  it("summarizes working and waiting Codex tasks without replacing app controls", () => {
    const codexWorktrees: CodexIntegrationSnapshot["worktrees"] = {
      worktree: {
        tasks: [
          {
            activity: {
              observedAt: "2026-07-18T10:00:00.000Z",
              state: "working",
              subagentCount: 0,
            },
            contextSharedAt: null,
            createdAt: "2026-07-18T09:00:00.000Z",
            id: "task-a",
            title: "Active task",
            updatedAt: "2026-07-18T10:01:00.000Z",
          },
          {
            activity: {
              observedAt: "2026-07-18T10:00:00.000Z",
              state: "waiting-for-approval",
              subagentCount: 0,
            },
            contextSharedAt: null,
            createdAt: "2026-07-18T09:00:00.000Z",
            id: "task-b",
            title: "Waiting task",
            updatedAt: "2026-07-18T10:01:00.000Z",
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(WorktreeTable, {
        appGroupActionBlocked: () => false,
        appGroupActionPending: () => false,
        codexWorktrees,
        commandActions: {
          onRestart: () => undefined,
          onSetup: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
        },
        onCreateAppGroupInstance: async () => undefined,
        onDelete: () => undefined,
        onInspect: () => undefined,
        onRestartAppGroup: () => undefined,
        onRetryAppGroup: () => undefined,
        onSelectAppGroupInstance: () => undefined,
        onToggleAppGroup: () => undefined,
        selectedId: null,
        worktreeActionPending: () => false,
        worktrees: [worktree],
      })
    );

    expect(markup).toContain("1 live");
    expect(markup).toContain("1 waiting");
    expect(markup).toContain('data-slot="app-group-grid"');
  });
});
