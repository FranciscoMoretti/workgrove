import {
  PlayIcon,
  RotateCwIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react";

import type { WorktreeSnapshot } from "../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsAreStopped,
  appsCanRestart,
} from "../controller/workspace-snapshot";
import type { CommandMenuItem } from "./components/command-menu-items";

export interface WorktreeCommandActions {
  onRestart: (worktree: WorktreeSnapshot) => void;
  onSetup: (worktree: WorktreeSnapshot) => void;
  onStart: (worktree: WorktreeSnapshot) => void;
  onStop: (worktree: WorktreeSnapshot) => void;
  setupAvailable: boolean;
}

export function worktreeCommandMenuItems({
  actions,
  pending,
  worktree,
}: {
  actions: WorktreeCommandActions;
  pending: boolean;
  worktree: WorktreeSnapshot;
}): CommandMenuItem[] {
  const running = appsAreRunning(worktree);
  const stopped = appsAreStopped(worktree);
  return [
    {
      disabled: pending || !actions.setupAvailable,
      icon: Settings2Icon,
      id: "setup",
      label: "Setup apps",
      onSelect: () => actions.onSetup(worktree),
      separatorBefore: true,
    },
    ...(stopped
      ? [
          {
            disabled: pending || worktree.slotState !== "assigned",
            icon: PlayIcon,
            id: "start",
            label: "Start apps",
            onSelect: () => actions.onStart(worktree),
          },
        ]
      : []),
    ...(running
      ? [
          {
            disabled: pending,
            icon: SquareIcon,
            id: "stop",
            label: "Stop apps",
            onSelect: () => actions.onStop(worktree),
          },
        ]
      : []),
    ...(appsCanRestart(worktree)
      ? [
          {
            disabled: pending,
            icon: RotateCwIcon,
            id: "restart",
            label: "Restart apps",
            onSelect: () => actions.onRestart(worktree),
          },
        ]
      : []),
  ];
}
