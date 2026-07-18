import {
  MoreHorizontalIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import {
  appGroupCanRestart,
  appGroupIsRunning,
} from "../../controller/workspace-snapshot";
import { type CommandMenuItem, CommandMenuItems } from "./command-menu-items";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function appGroupCommandMenuItems({
  group,
  onRestart,
  onToggle,
  pending,
}: {
  group: AppGroupSnapshot;
  onRestart: () => void;
  onToggle: () => void;
  pending: boolean;
}): CommandMenuItem[] {
  const running = appGroupIsRunning(group);
  return [
    {
      disabled: pending || (!running && group.slotState !== "assigned"),
      icon: running ? SquareIcon : PlayIcon,
      id: running ? "stop" : "start",
      label: running ? `Stop ${group.name}` : `Start ${group.name}`,
      onSelect: onToggle,
    },
    ...(appGroupCanRestart(group)
      ? [
          {
            disabled: pending,
            icon: RotateCwIcon,
            id: "restart",
            label: `Restart ${group.name}`,
            onSelect: onRestart,
          },
        ]
      : []),
  ];
}

export function AppGroupActionsMenu({
  group,
  onRestart,
  onToggle,
  pending,
  worktree,
}: {
  group: AppGroupSnapshot;
  onRestart: () => void;
  onToggle: () => void;
  pending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const items = appGroupCommandMenuItems({
    group,
    onRestart,
    onToggle,
    pending,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${group.name} in ${worktree.name}`}
            size="icon"
            variant="ghost"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <CommandMenuItems items={items} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
