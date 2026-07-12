import {
  ChevronRightIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlayIcon,
  RotateCwIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react";

import type {
  SlotOption,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsAreStopped,
  appsCanRestart,
} from "../../controller/workspace-snapshot";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
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
    return "mini-dot on";
  }
  return app.ownership === "foreign" ? "mini-dot conflict" : "mini-dot";
}

function appActionIndicator(pending: boolean, running: boolean) {
  if (pending) {
    return <LoaderCircleIcon className="spin" />;
  }
  return running ? <SquareIcon /> : <span className="health-dot" />;
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
  defaultSlot,
  onDelete,
  onInspect,
  onRestartApps,
  onSetSlot,
  onToggleApps,
  selectedId,
  slots,
  visibleActions,
  worktrees,
}: {
  actionPending: (worktreeId: string) => boolean;
  defaultSlot: number;
  onDelete: (worktree: WorktreeSnapshot) => void;
  onInspect: (worktreeId: string) => void;
  onRestartApps: (worktree: WorktreeSnapshot) => void;
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
  const canSetupVisible =
    visibleActions.setupAvailable &&
    worktrees.some((worktree) => appsAreStopped(worktree));
  const canStartVisible = worktrees.some(
    (worktree) => worktree.slotState === "assigned" && appsAreStopped(worktree)
  );
  const canStopVisible = worktrees.some(appsAreRunning);
  const canRestartVisible = worktrees.some(appsCanRestart);
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>
              <span>Repository</span>
            </th>
            <th>Branch</th>
            <th>
              <div className="table-heading apps-heading">
                <span>Apps</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Visible worktree app actions"
                      className="menu-trigger compact-menu-trigger"
                      size="icon"
                      variant="ghost"
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="bulk-menu">
                    <DropdownMenuLabel>Visible worktrees</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!canSetupVisible || visibleActions.pending}
                      onSelect={visibleActions.onSetup}
                    >
                      <Settings2Icon />
                      Setup all
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canStartVisible || visibleActions.pending}
                      onSelect={visibleActions.onStart}
                    >
                      <PlayIcon />
                      Start all
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canRestartVisible || visibleActions.pending}
                      onSelect={visibleActions.onRestart}
                    >
                      <RotateCwIcon />
                      Restart running
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canStopVisible || visibleActions.pending}
                      onSelect={visibleActions.onStop}
                    >
                      <SquareIcon />
                      Stop all
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </th>
            <th>Ports</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {worktrees.map((worktree) => {
            const pending = actionPending(worktree.id);
            const appSlot = worktree.slot ?? defaultSlot;
            const appName = worktree.appLabel;
            const running = appsAreRunning(worktree);
            return (
              <tr
                className={selectedId === worktree.id ? "selected" : ""}
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
                <td>
                  <div className="repo-cell">
                    <div>
                      <strong>{worktree.name}</strong>
                      {worktree.isMain ? (
                        <em className="main-badge">Main</em>
                      ) : null}
                      <ChevronRightIcon />
                    </div>
                    <span>{worktree.path}</span>
                    {worktree.slotState === "invalid" ||
                    worktree.slotState === "conflicting" ? (
                      <em className={`slot-state ${worktree.slotState}`}>
                        {slotStateText(worktree.slotState)}
                      </em>
                    ) : null}
                    {worktree.setupState === "failed" ? (
                      <em className="setup-state failed">
                        Setup failed · retry from Apps menu
                      </em>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="branch-cell">
                    <GitBranchIcon />
                    <span>{worktree.branch}</span>
                  </div>
                </td>
                <td>
                  <div className="split-control">
                    <Button
                      aria-label={`${running ? "Stop" : "Start"} ${appName}`}
                      className="apps-button"
                      data-health={worktree.health}
                      disabled={
                        pending ||
                        (!running && worktree.slotState !== "assigned")
                      }
                      onClick={() => onToggleApps(worktree)}
                      title={`${statusText(worktree.health, running)} · slot ${appSlot}`}
                      variant="secondary"
                    >
                      {appActionIndicator(pending, running)}
                      <b>{appName}</b>
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
                        className="slot-trigger"
                      />
                      <SelectContent className="slot-select-content">
                        {slots.map((option) => {
                          const occupiedByOther =
                            option.occupiedBy !== null &&
                            option.slot !== worktree.slot;
                          return (
                            <SelectItem
                              className="slot-select-item"
                              disabled={occupiedByOther || pending}
                              key={option.slot}
                              value={String(option.slot)}
                            >
                              <span className="slot-select-row">
                                <span className="slot-select-identity">
                                  <b>Slot {option.slot}</b>
                                  <small>
                                    {slotAvailability(
                                      occupiedByOther,
                                      option.occupiedBy,
                                      option.slot === worktree.slot
                                    )}
                                  </small>
                                </span>
                                <span className="slot-select-ports">
                                  {option.apps
                                    .map((app) => `${app.label} ${app.port}`)
                                    .join(" · ")}
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </td>
                <td>
                  <div className="ports-cell">
                    {worktree.apps.map((app) => (
                      <div className="port-row" key={app.id}>
                        <span className={indicatorClass(app)} />
                        <span>{app.label}</span>
                        {app.open && app.listening ? (
                          <a href={app.url} rel="noreferrer" target="_blank">
                            {app.port}
                          </a>
                        ) : (
                          <code>{app.port}</code>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td>
                  <WorktreeActionsMenu
                    onDelete={() => onDelete(worktree)}
                    onInspect={() => onInspect(worktree.id)}
                    onRestart={() => onRestartApps(worktree)}
                    pending={pending}
                    worktree={worktree}
                  />
                </td>
              </tr>
            );
          })}
          {worktrees.length === 0 ? (
            <tr>
              <td className="empty-table" colSpan={5}>
                No Git worktrees found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
