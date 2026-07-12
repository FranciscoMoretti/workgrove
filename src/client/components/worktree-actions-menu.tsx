import { MoreHorizontalIcon, RotateCwIcon, Trash2Icon } from "lucide-react";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import {
  appsAreRunning,
  appsCanRestart,
} from "../../controller/workspace-snapshot";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function WorktreeActionsMenu({
  bordered = false,
  onDelete,
  onInspect,
  onRestart,
  pending,
  worktree,
}: {
  bordered?: boolean;
  onDelete: () => void;
  onInspect: () => void;
  onRestart: () => void;
  pending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const running = appsAreRunning(worktree);
  const canRestart = appsCanRestart(worktree);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Actions for ${worktree.name}`}
          className={
            bordered ? "bordered-menu-trigger menu-trigger" : "menu-trigger"
          }
          size="icon"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onInspect}>View details</DropdownMenuItem>
        {canRestart ? (
          <DropdownMenuItem disabled={pending} onSelect={onRestart}>
            <RotateCwIcon />
            Restart apps
          </DropdownMenuItem>
        ) : null}
        {worktree.isMain ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              disabled={pending || running}
              onSelect={onDelete}
            >
              <Trash2Icon />
              Delete worktree
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
