import { BotIcon, GitBranchIcon, PlayIcon, SquareIcon } from "lucide-react";

import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appGroupIsRunning } from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppGroupActionsMenu } from "./app-group-actions-menu";
import { AppGroupInstanceControl } from "./app-group-instance-control";
import { AppPort } from "./app-port";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { WorktreeActionsMenu } from "./worktree-actions-menu";

function status(group: AppGroupSnapshot): string {
  if (group.health === "running") {
    return "Running";
  }
  if (group.health === "partially-running") {
    return "Partially running";
  }
  return group.processRunning ? "Process running" : "Not running";
}

function actionIcon(pending: boolean, running: boolean) {
  if (pending) {
    return <Spinner />;
  }
  return running ? <SquareIcon /> : <PlayIcon />;
}

function CodexTaskSummary({
  availability,
  tasks,
}: {
  availability: "loading" | "ready" | "unavailable";
  tasks: CodexIntegrationSnapshot["worktrees"][string]["tasks"] | undefined;
}) {
  if (!tasks) {
    let label = "—";
    if (availability === "unavailable") {
      label = "Unavailable";
    } else if (availability === "loading") {
      label = "Loading…";
    }
    return <span className="text-muted-foreground text-xs">{label}</span>;
  }
  if (tasks.length === 0) {
    return <span className="text-muted-foreground text-xs">No tasks</span>;
  }
  const working = tasks.filter(
    (task) => task.activity?.state === "working"
  ).length;
  const waiting = tasks.filter(
    (task) => task.activity?.state === "waiting-for-approval"
  ).length;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="outline">
        <BotIcon />
        {tasks.length}
      </Badge>
      {working > 0 ? (
        <span className="flex items-center gap-1 text-status-running-foreground text-xs">
          <span className="size-1.5 rounded-full bg-current" />
          {working} live
        </span>
      ) : null}
      {waiting > 0 ? (
        <span className="flex items-center gap-1 text-status-partial-foreground text-xs">
          <span className="size-1.5 rounded-full bg-current" />
          {waiting} waiting
        </span>
      ) : null}
    </div>
  );
}

function friendlyUrlLabel(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
}

export function WorktreeTable({
  appGroupActionBlocked,
  appGroupActionPending,
  codexAvailability = "ready",
  codexWorktrees,
  commandActions,
  onDelete,
  onInspect,
  onCreateAppGroupInstance,
  onRestartAppGroup,
  onRetryAppGroup,
  onSelectAppGroupInstance,
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
  onCreateAppGroupInstance?: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot,
    name: string
  ) => Promise<void>;
  onRestartAppGroup: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  onRetryAppGroup?: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  onSelectAppGroupInstance?: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot,
    instanceId: string
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
    <ScrollArea
      className="worktree-table h-full min-w-0 border bg-card"
      scrollbars={["vertical", "horizontal"]}
    >
      <Table
        className="min-w-[1020px]"
        containerClassName="w-max min-w-full overflow-visible"
      >
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-[24%]">Worktree</TableHead>
            <TableHead className="w-[16%]">Branch</TableHead>
            <TableHead>App groups</TableHead>
            <TableHead className="w-[14%]">Codex</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {worktrees.map((worktree) => {
            const worktreePending = worktreeActionPending(worktree.id);
            return (
              <TableRow
                className="cursor-default"
                data-state={selectedId === worktree.id ? "selected" : undefined}
                key={worktree.id}
                onClick={(event) => {
                  if (
                    !(event.target as Element).closest(
                      "button, a, [role=option]"
                    )
                  ) {
                    onInspect(worktree.id);
                  }
                }}
              >
                <TableCell>
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <strong>{worktree.name}</strong>
                      {worktree.isMain ? (
                        <Badge variant="secondary">Main</Badge>
                      ) : null}
                    </div>
                    <span className="truncate font-mono text-muted-foreground">
                      {worktree.path}
                    </span>
                    {worktree.setupState === "failed" ? (
                      <Badge variant="destructive">Setup failed</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <GitBranchIcon className="text-muted-foreground" />
                    <span className="truncate font-mono text-muted-foreground">
                      {worktree.branch}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div
                    className="grid grid-cols-[repeat(auto-fit,minmax(24rem,1fr))] gap-x-4 gap-y-2"
                    data-slot="app-group-grid"
                  >
                    {worktree.appGroups.map((group) => {
                      const blocked = appGroupActionBlocked(
                        worktree.id,
                        group.id
                      );
                      const pending = appGroupActionPending(
                        worktree.id,
                        group.id
                      );
                      const running = appGroupIsRunning(group);
                      return (
                        <div
                          className="grid min-w-0 grid-cols-[minmax(7rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-2 border-l pl-4"
                          data-app-group={group.name}
                          key={group.id}
                        >
                          <div className="grid min-w-0 gap-1">
                            <span
                              className="min-w-0 truncate font-medium"
                              title={group.name}
                            >
                              {group.name}
                            </span>
                            <AppGroupInstanceControl
                              disabled={blocked}
                              group={group}
                              onCreate={(name) =>
                                onCreateAppGroupInstance?.(
                                  worktree,
                                  group,
                                  name
                                ) ?? Promise.resolve()
                              }
                              onSelect={(instanceId) =>
                                onSelectAppGroupInstance?.(
                                  worktree,
                                  group,
                                  instanceId
                                )
                              }
                            />
                          </div>
                          <Button
                            aria-label={`${running ? "Stop" : "Start"} ${group.name} for ${worktree.name}`}
                            className="min-w-24 justify-start"
                            data-health={group.health}
                            disabled={blocked}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleAppGroup(worktree, group);
                            }}
                            title={status(group)}
                            variant="outline"
                          >
                            {actionIcon(pending, running)}
                            {running ? "Stop" : "Start"}
                          </Button>
                          <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                            {group.apps.map((app) => (
                              <span
                                className="flex items-center gap-1"
                                key={app.id}
                              >
                                <span
                                  className={
                                    app.listening
                                      ? "size-1.5 rounded-full bg-foreground"
                                      : "size-1.5 rounded-full bg-muted-foreground/60"
                                  }
                                />
                                {app.label}{" "}
                                {app.open && app.listening ? (
                                  <a
                                    className="underline"
                                    href={app.url ?? undefined}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {friendlyUrlLabel(app.url ?? "")}
                                  </a>
                                ) : (
                                  <AppPort port={app.port} />
                                )}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1">
                            <AppGroupActionsMenu
                              group={group}
                              onRestart={() =>
                                onRestartAppGroup(worktree, group)
                              }
                              onRetry={() => onRetryAppGroup?.(worktree, group)}
                              onToggle={() => onToggleAppGroup(worktree, group)}
                              pending={blocked}
                              worktree={worktree}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <CodexTaskSummary
                    availability={codexAvailability}
                    tasks={codexWorktrees?.[worktree.id]?.tasks}
                  />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <WorktreeActionsMenu
                    commandActions={commandActions}
                    includeLifecycle={false}
                    onDelete={() => onDelete(worktree)}
                    onInspect={() => onInspect(worktree.id)}
                    pending={worktreePending}
                    worktree={worktree}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {worktrees.length === 0 ? (
            <TableRow>
              <TableCell className="h-48" colSpan={5}>
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No Git worktrees found</EmptyTitle>
                    <EmptyDescription>
                      Add a worktree to this repository to manage it here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
