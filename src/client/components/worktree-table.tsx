import {
  BotIcon,
  ChevronRightIcon,
  GitBranchIcon,
  PlayIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react";

import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";
import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appGroupIsRunning } from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppEndpointLink } from "./app-endpoint-link";
import { AppGroupActionsMenu } from "./app-group-actions-menu";
import {
  appGroupDisplayStatus,
  worktreeDisplayStatus,
} from "./app-group-status";
import { StatusSummary } from "./status-summary";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import { WorktreeActionsMenu } from "./worktree-actions-menu";

function actionIcon(pending: boolean, running: boolean) {
  if (pending) {
    return <Spinner />;
  }
  return running ? <SquareIcon /> : <PlayIcon />;
}

function routeIssueLabel(app: AppGroupSnapshot["apps"][number]) {
  if (app.protocol !== "http" || app.readiness !== "ready") {
    return null;
  }
  if (app.routeState === "conflict") {
    return "Route conflict";
  }
  if (app.routeState === "unavailable") {
    return "Route unavailable";
  }
  return null;
}

function CodexTaskSummary({
  availability,
  tasks,
}: {
  availability: "loading" | "ready" | "unavailable";
  tasks: CodexIntegrationSnapshot["worktrees"][string]["tasks"] | undefined;
}) {
  if (!tasks) {
    let label = "No tasks";
    if (availability === "unavailable") {
      label = "Unavailable";
    } else if (availability === "loading") {
      label = "Loading…";
    }
    return (
      <span className="worktree-empty-value text-muted-foreground">
        {label}
      </span>
    );
  }
  if (tasks.length === 0) {
    return (
      <span className="worktree-empty-value text-muted-foreground">
        No tasks
      </span>
    );
  }
  const working = tasks.filter(
    (task) => task.activity?.state === "working"
  ).length;
  const waiting = tasks.filter(
    (task) => task.activity?.state === "waiting-for-approval"
  ).length;
  return (
    <div className="codex-summary">
      <span className="codex-summary-count">
        <BotIcon />
        {tasks.length}
      </span>
      {working > 0 ? (
        <span className="codex-summary-state" data-state="working">
          <span aria-hidden="true" />
          {working} live
        </span>
      ) : null}
      {waiting > 0 ? (
        <span className="codex-summary-state" data-state="waiting">
          <span aria-hidden="true" />
          {waiting} waiting
        </span>
      ) : null}
    </div>
  );
}

function AppGroupSummary({
  blocked,
  group,
  onInspect,
  onRestart,
  onRetry,
  onToggle,
  worktree,
}: {
  blocked: boolean;
  group: AppGroupSnapshot;
  onInspect: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onToggle: () => void;
  worktree: WorktreeSnapshot;
}) {
  return (
    <div
      className="app-group-summary"
      data-app-group={group.name}
      data-status={appGroupDisplayStatus(group)}
    >
      <div className="app-group-summary-heading">
        <div className="min-w-0">
          <Button
            aria-label={`Inspect ${group.name} details`}
            className="app-group-heading-link"
            onClick={onInspect}
            size="sm"
            variant="ghost"
          >
            <strong className="truncate">{group.name}</strong>
            <StatusSummary status={appGroupDisplayStatus(group)} />
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
          {group.instance.mode === "selectable" ? (
            <span className="app-group-instance-label">
              Instance: {group.instance.name}
            </span>
          ) : null}
        </div>
        <div className="app-group-summary-actions">
          <AppGroupActionsMenu
            group={group}
            onRestart={onRestart}
            onRetry={onRetry}
            onToggle={onToggle}
            pending={blocked}
            worktree={worktree}
          />
        </div>
      </div>
      <div className="app-endpoint-list">
        {group.apps.length > 0 ? (
          group.apps.map((app) => {
            const routeIssue = routeIssueLabel(app);
            return (
              <span className="app-endpoint-summary" key={app.id}>
                <span
                  aria-hidden="true"
                  className="app-endpoint-dot"
                  data-listening={app.listening || undefined}
                  data-ownership={app.ownership}
                  data-readiness={app.readiness}
                  data-route-state={app.routeState}
                />
                <span>{app.label}</span>
                <AppEndpointLink app={app} />
                {routeIssue ? (
                  <span className="app-endpoint-route-issue">{routeIssue}</span>
                ) : null}
              </span>
            );
          })
        ) : (
          <span className="text-muted-foreground">No Apps configured</span>
        )}
      </div>
    </div>
  );
}

function WorktreePrimaryAction({
  actions,
  blocked,
  pending,
  primaryGroup,
  worktree,
}: {
  actions: WorktreeCommandActions;
  blocked: boolean;
  pending: boolean;
  primaryGroup: AppGroupSnapshot | undefined;
  worktree: WorktreeSnapshot;
}) {
  if (worktree.setupState === "running") {
    return (
      <Button disabled size="sm" variant="outline">
        <Spinner />
        Setting up
      </Button>
    );
  }
  if (worktree.setupState === "failed") {
    return (
      <Button
        disabled={blocked}
        onClick={() => actions.onSetup(worktree)}
        size="sm"
        variant="outline"
      >
        {pending ? <Spinner /> : <Settings2Icon />}
        Retry setup
      </Button>
    );
  }
  const running = primaryGroup ? appGroupIsRunning(primaryGroup) : false;
  return (
    <Button
      disabled={blocked || !primaryGroup}
      onClick={() =>
        running ? actions.onStop(worktree) : actions.onStart(worktree)
      }
      size="sm"
      variant={running ? "secondary" : "default"}
    >
      {actionIcon(pending, running)}
      {running ? "Stop apps" : "Start apps"}
    </Button>
  );
}

export function WorktreeTable({
  appGroupActionBlocked,
  appGroupActionPending,
  codexAvailability = "ready",
  codexWorktrees,
  commandActions,
  onDelete,
  onInspect,
  onInspectAppGroup,
  onRestartAppGroup,
  onRetryAppGroup,
  onToggleAppGroup,
  selectedId,
  worktreeActionPending,
  worktrees,
}: {
  appGroupActionBlocked: (worktreeId: string, appGroupName: string) => boolean;
  appGroupActionPending: (worktreeId: string, appGroupName: string) => boolean;
  codexAvailability?: "loading" | "ready" | "unavailable";
  codexWorktrees?: CodexIntegrationSnapshot["worktrees"];
  commandActions: WorktreeCommandActions;
  onDelete: (worktree: WorktreeSnapshot) => void;
  onInspect: (worktreeId: string) => void;
  onInspectAppGroup: (worktreeId: string, appGroupId: string) => void;
  onRestartAppGroup: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  onRetryAppGroup: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  onToggleAppGroup: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  selectedId: string | null;
  worktreeActionPending: (worktreeId: string) => boolean;
  worktrees: WorktreeSnapshot[];
}) {
  return (
    <ScrollArea className="worktree-console h-full min-w-0">
      <div aria-hidden="true" className="worktree-console-header">
        <span>Worktree</span>
        <span>App groups and Apps</span>
        <span>Codex</span>
        <span>Action</span>
      </div>
      <div className="worktree-table">
        {worktrees.map((worktree) => {
          const displayStatus = worktreeDisplayStatus(worktree);
          const worktreePending = worktreeActionPending(worktree.id);
          const primaryGroup = worktree.appGroups.find(
            (group) => group.id === worktree.primaryAppGroup
          );
          const primaryGroupBlocked = primaryGroup
            ? appGroupActionBlocked(worktree.id, primaryGroup.id)
            : false;
          const primaryGroupPending = primaryGroup
            ? appGroupActionPending(worktree.id, primaryGroup.id)
            : false;
          const primaryActionBlocked = worktreePending || primaryGroupBlocked;
          const primaryActionPending = worktreePending || primaryGroupPending;
          return (
            <article
              className="worktree-row"
              data-state={selectedId === worktree.id ? "selected" : undefined}
              data-status={displayStatus}
              key={worktree.id}
            >
              <Button
                aria-label={`Inspect ${worktree.name}`}
                aria-pressed={selectedId === worktree.id}
                className="worktree-identity"
                onClick={() => onInspect(worktree.id)}
                variant="ghost"
              >
                <span aria-hidden="true" className="worktree-branch-rail">
                  <span />
                </span>
                <span className="worktree-identity-copy">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong className="truncate">{worktree.name}</strong>
                    {worktree.isMain ? (
                      <Badge variant="secondary">Main</Badge>
                    ) : null}
                  </span>
                  <span className="worktree-branch">
                    <GitBranchIcon />
                    <span className="truncate">{worktree.branch}</span>
                  </span>
                  <StatusSummary status={displayStatus} />
                </span>
              </Button>
              <div className="app-group-grid" data-slot="app-group-grid">
                {worktree.appGroups.map((group) => (
                  <AppGroupSummary
                    blocked={appGroupActionBlocked(worktree.id, group.id)}
                    group={group}
                    key={group.id}
                    onInspect={() => onInspectAppGroup(worktree.id, group.id)}
                    onRestart={() => onRestartAppGroup(worktree, group)}
                    onRetry={() => onRetryAppGroup(worktree, group)}
                    onToggle={() => onToggleAppGroup(worktree, group)}
                    worktree={worktree}
                  />
                ))}
              </div>
              <div className="worktree-codex">
                <CodexTaskSummary
                  availability={codexAvailability}
                  tasks={codexWorktrees?.[worktree.id]?.tasks}
                />
              </div>
              <div className="worktree-row-actions">
                <WorktreePrimaryAction
                  actions={commandActions}
                  blocked={primaryActionBlocked}
                  pending={primaryActionPending}
                  primaryGroup={primaryGroup}
                  worktree={worktree}
                />
                <WorktreeActionsMenu
                  commandActions={commandActions}
                  includeLifecycle={false}
                  onDelete={() => onDelete(worktree)}
                  onInspect={() => onInspect(worktree.id)}
                  pending={primaryActionBlocked}
                  worktree={worktree}
                />
              </div>
            </article>
          );
        })}
        {worktrees.length === 0 ? (
          <div className="worktree-empty">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No Git worktrees found</EmptyTitle>
                <EmptyDescription>
                  Create a worktree to give another branch its own runnable
                  environment.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
