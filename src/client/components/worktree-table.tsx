import { GitBranchIcon, PlayIcon, SquareIcon } from "lucide-react";

import type {
  AppGroupSlotOption,
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appGroupIsRunning } from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppPort } from "./app-port";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "./ui/select";
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

function groupMode(group: AppGroupSnapshot): string {
  if (group.slotState === "conflicting") {
    return "port conflict";
  }
  return group.stop;
}

export function WorktreeTable({
  actionPending,
  appGroupSlots,
  commandActions,
  onDelete,
  onInspect,
  onSetSlot,
  onToggleAppGroup,
  selectedId,
  worktrees,
}: {
  actionPending: (worktreeId: string) => boolean;
  appGroupSlots: Record<string, AppGroupSlotOption[]>;
  commandActions: WorktreeCommandActions;
  onDelete: (worktree: WorktreeSnapshot) => void;
  onInspect: (worktreeId: string) => void;
  onSetSlot: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot,
    slot: AppGroupSlotOption
  ) => void;
  onToggleAppGroup: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot
  ) => void;
  selectedId: string | null;
  worktrees: WorktreeSnapshot[];
}) {
  return (
    <ScrollArea
      className="worktree-table h-full min-w-0 border bg-card"
      scrollbars={["vertical", "horizontal"]}
    >
      <Table
        className="min-w-[900px]"
        containerClassName="w-max min-w-full overflow-visible"
      >
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-[28%]">Worktree</TableHead>
            <TableHead className="w-[18%]">Branch</TableHead>
            <TableHead className="w-[34%]">App groups</TableHead>
            <TableHead>Endpoints</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {worktrees.map((worktree) => {
            const pending = actionPending(worktree.id);
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
                <TableCell>
                  <div className="grid gap-2">
                    {worktree.appGroups.map((group) => {
                      const running = appGroupIsRunning(group);
                      const slots = appGroupSlots[group.name] ?? [];
                      return (
                        <div
                          className="flex items-center gap-2"
                          key={group.name}
                        >
                          <span
                            className="w-32 truncate font-medium"
                            title={group.name}
                          >
                            {group.name}
                          </span>
                          <ButtonGroup
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              aria-label={`${running ? "Stop" : "Start"} ${group.name} for ${worktree.name}`}
                              className="min-w-24 justify-start"
                              data-health={group.health}
                              disabled={
                                pending ||
                                (!running && group.slotState !== "assigned")
                              }
                              onClick={() => onToggleAppGroup(worktree, group)}
                              title={`${status(group)} · Slot ${group.slot}`}
                              variant="outline"
                            >
                              {actionIcon(pending, running)}
                              Slot {group.slot}
                            </Button>
                            <Select
                              onValueChange={(value) => {
                                const option = slots.find(
                                  (candidate) =>
                                    candidate.slot === Number(value)
                                );
                                if (option && option.slot !== group.slot) {
                                  onSetSlot(worktree, group, option);
                                }
                              }}
                              value={String(group.slot)}
                            >
                              <SelectTrigger
                                aria-label={`Choose slot for ${group.name} in ${worktree.name}`}
                                className="w-8 [&_[data-slot=select-value]]:hidden"
                              />
                              <SelectContent className="min-w-72">
                                <SelectGroup>
                                  {slots.map((option) => (
                                    <SelectItem
                                      disabled={pending}
                                      key={option.slot}
                                      value={String(option.slot)}
                                    >
                                      <span className="flex w-full justify-between gap-6">
                                        <b>Slot {option.slot}</b>
                                        <span className="text-muted-foreground">
                                          {option.apps
                                            .map(
                                              (app) =>
                                                `${app.label} :${app.port}`
                                            )
                                            .join(" · ")}
                                        </span>
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </ButtonGroup>
                          <Badge
                            variant={
                              group.slotState === "conflicting"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {groupMode(group)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid gap-2">
                    {worktree.appGroups.map((group) => (
                      <div
                        className="flex flex-wrap gap-x-3 gap-y-1"
                        key={group.name}
                      >
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
                                href={app.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <AppPort port={app.port} />
                              </a>
                            ) : (
                              <AppPort port={app.port} />
                            )}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <WorktreeActionsMenu
                    commandActions={commandActions}
                    onDelete={() => onDelete(worktree)}
                    onInspect={() => onInspect(worktree.id)}
                    pending={pending}
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
