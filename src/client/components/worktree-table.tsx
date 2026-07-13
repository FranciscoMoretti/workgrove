import {
  ChevronRightIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PlayIcon,
  RotateCwIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react";
import { Fragment } from "react";

import type {
  SlotOption,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsAreStopped,
  appsCanRestart,
} from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { type CommandMenuItem, CommandMenuItems } from "./command-menu-items";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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

function statusText(
  health: WorktreeSnapshot["health"],
  running: boolean
): string {
  if (health === "running") {
    return "Running";
  }
  if (health === "partially-running") {
    return "Partially running";
  }
  return running ? "Managed process running" : "Not running";
}

function indicatorClass(app: WorktreeSnapshot["apps"][number]): string {
  if (app.listening) {
    return "size-1.5 rounded-full bg-foreground";
  }
  return app.ownership === "foreign"
    ? "size-1.5 rounded-full bg-destructive"
    : "size-1.5 rounded-full bg-muted-foreground/60";
}

function appActionIndicator(pending: boolean, running: boolean) {
  if (pending) {
    return <Spinner />;
  }
  return running ? (
    <SquareIcon data-icon="inline-start" />
  ) : (
    <span className="size-2 rounded-full bg-muted-foreground" />
  );
}

function slotStateText(state: WorktreeSnapshot["slotState"]): string {
  return state === "invalid" ? "Invalid slot" : "Slot conflict";
}

function slotAvailability(
  occupiedByOther: boolean,
  occupiedBy: string | null,
  current: boolean
): string {
  if (occupiedByOther) {
    return `In use by ${occupiedBy}`;
  }
  return current ? "Current assignment" : "Available";
}

export function WorktreeTable({
  actionPending,
  commandActions,
  defaultSlot,
  onDelete,
  onInspect,
  onSetSlot,
  onToggleApps,
  selectedId,
  slots,
  visibleActions,
  worktrees,
}: {
  actionPending: (worktreeId: string) => boolean;
  commandActions: WorktreeCommandActions;
  defaultSlot: number;
  onDelete: (worktree: WorktreeSnapshot) => void;
  onInspect: (worktreeId: string) => void;
  onSetSlot: (worktree: WorktreeSnapshot, slot: SlotOption) => void;
  onToggleApps: (worktree: WorktreeSnapshot) => void;
  selectedId: string | null;
  slots: SlotOption[];
  visibleActions: {
    onRestart: () => void;
    onSetup: () => void;
    onStart: () => void;
    onStop: () => void;
    pending: boolean;
    setupAvailable: boolean;
  };
  worktrees: WorktreeSnapshot[];
}) {
  const canSetupVisible = visibleActions.setupAvailable && worktrees.length > 0;
  const canStartVisible = worktrees.some(
    (worktree) => worktree.slotState === "assigned" && appsAreStopped(worktree)
  );
  const canStopVisible = worktrees.some(appsAreRunning);
  const canRestartVisible = worktrees.some(appsCanRestart);
  const visibleCommandItems: CommandMenuItem[] = [
    {
      disabled: !canSetupVisible || visibleActions.pending,
      icon: Settings2Icon,
      id: "setup-all",
      label: "Setup all",
      onSelect: visibleActions.onSetup,
    },
    {
      disabled: !canStartVisible || visibleActions.pending,
      icon: PlayIcon,
      id: "start-all",
      label: "Start all",
      onSelect: visibleActions.onStart,
    },
    {
      disabled: !canRestartVisible || visibleActions.pending,
      icon: RotateCwIcon,
      id: "restart-running",
      label: "Restart running",
      onSelect: visibleActions.onRestart,
    },
    {
      disabled: !canStopVisible || visibleActions.pending,
      icon: SquareIcon,
      id: "stop-all",
      label: "Stop all",
      onSelect: visibleActions.onStop,
    },
  ];
  return (
    <ScrollArea
      className="h-full min-w-0 border bg-card"
      scrollbars={["vertical", "horizontal"]}
    >
      <Table
        className="min-w-[900px]"
        containerClassName="w-max min-w-full overflow-visible"
      >
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-[34%]">
              <span>Repository</span>
            </TableHead>
            <TableHead className="w-[18%]">Branch</TableHead>
            <TableHead className="w-[22%]">
              <div className="flex items-center gap-1">
                <span>Apps</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="Visible worktree app actions"
                        size="icon"
                        variant="ghost"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Visible worktrees</DropdownMenuLabel>
                      <CommandMenuItems items={visibleCommandItems} />
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableHead>
            <TableHead className="w-[16%]">Ports</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {worktrees.map((worktree) => {
            const pending = actionPending(worktree.id);
            const appSlot = worktree.slot ?? defaultSlot;
            const slotLabel = `Slot ${appSlot}`;
            const running = appsAreRunning(worktree);
            return (
              <TableRow
                data-state={selectedId === worktree.id ? "selected" : undefined}
                key={worktree.id}
                onClick={(event) => {
                  if (
                    !(event.target as Element).closest(
                      "button, a, [role=menuitem], [role=option]"
                    )
                  ) {
                    onInspect(worktree.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.currentTarget === event.target &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    onInspect(worktree.id);
                  }
                }}
                tabIndex={0}
              >
                <TableCell className="h-18">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-1.5">
                      <strong className="truncate font-medium text-sm">
                        {worktree.name}
                      </strong>
                      {worktree.isMain ? (
                        <Badge variant="secondary">Main</Badge>
                      ) : null}
                      <ChevronRightIcon className="text-muted-foreground" />
                    </div>
                    <span className="truncate font-mono text-muted-foreground">
                      {worktree.path}
                    </span>
                    {worktree.slotState === "invalid" ||
                    worktree.slotState === "conflicting" ? (
                      <Badge variant="destructive">
                        {slotStateText(worktree.slotState)}
                      </Badge>
                    ) : null}
                    {worktree.setupState === "failed" ? (
                      <Badge variant="destructive">
                        Setup failed · retry from Apps menu
                      </Badge>
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
                  <ButtonGroup>
                    <Button
                      aria-label={`${running ? "Stop" : "Start"} apps in ${slotLabel} for ${worktree.name}`}
                      className="min-w-24 justify-start"
                      data-health={worktree.health}
                      disabled={
                        pending ||
                        (!running && worktree.slotState !== "assigned")
                      }
                      onClick={() => onToggleApps(worktree)}
                      title={`${statusText(worktree.health, running)} · ${slotLabel}`}
                      variant="outline"
                    >
                      {appActionIndicator(pending, running)}
                      <b>{slotLabel}</b>
                    </Button>
                    <Select
                      onValueChange={(value) => {
                        const option = slots.find(
                          (candidate) => candidate.slot === Number(value)
                        );
                        if (option && option.slot !== worktree.slot) {
                          onSetSlot(worktree, option);
                        }
                      }}
                      value={
                        worktree.slot === null ? "" : String(worktree.slot)
                      }
                    >
                      <SelectTrigger
                        aria-label={`Choose slot for ${worktree.name}`}
                        className="w-8 [&_[data-slot=select-value]]:hidden"
                      />
                      <SelectContent className="min-w-80">
                        <SelectGroup>
                          {slots.map((option) => {
                            const occupiedByOther =
                              option.occupiedBy !== null &&
                              option.slot !== worktree.slot;
                            return (
                              <SelectItem
                                disabled={occupiedByOther || pending}
                                key={option.slot}
                                value={String(option.slot)}
                              >
                                <span className="flex w-full items-center justify-between gap-6">
                                  <span className="grid gap-0.5">
                                    <b>Slot {option.slot}</b>
                                    <small className="text-muted-foreground">
                                      {slotAvailability(
                                        occupiedByOther,
                                        option.occupiedBy,
                                        option.slot === worktree.slot
                                      )}
                                    </small>
                                  </span>
                                  <span className="font-mono text-muted-foreground">
                                    {option.apps
                                      .map((app) => `${app.label} ${app.port}`)
                                      .join(" · ")}
                                  </span>
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </ButtonGroup>
                </TableCell>
                <TableCell>
                  <div className="grid grid-cols-[8px_max-content_max-content] items-center justify-start gap-x-2 gap-y-0.5">
                    {worktree.apps.map((app) => (
                      <Fragment key={app.id}>
                        <span className={indicatorClass(app)} />
                        <span>{app.label}</span>
                        {app.open && app.listening ? (
                          <a
                            className="text-right underline underline-offset-3"
                            href={app.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {app.port}
                          </a>
                        ) : (
                          <code className="text-right">{app.port}</code>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
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
