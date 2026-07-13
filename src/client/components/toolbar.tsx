import {
  ChevronDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  TreesIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { REFRESH_INTERVAL } from "../queries";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function repositoryName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function Toolbar({
  activeRepoPath,
  isFetching,
  mainWorktreePath,
  onCreate,
  onConfigureCommands,
  onOpenRepository,
  onRefresh,
  onSelectRepository,
  recentRepositories,
  repoName,
  updatedAt,
}: {
  activeRepoPath: string;
  isFetching: boolean;
  mainWorktreePath: string;
  onCreate: () => void;
  onConfigureCommands: () => void;
  onOpenRepository: () => void;
  onRefresh: () => void;
  onSelectRepository: (path: string) => void;
  recentRepositories: string[];
  repoName: string;
  updatedAt: number;
}) {
  const style = {
    "--refresh-duration": `${REFRESH_INTERVAL}ms`,
  } as CSSProperties;
  const repositories = [
    activeRepoPath,
    ...recentRepositories.filter((path) => path !== activeRepoPath),
  ];
  return (
    <header className="app-toolbar flex min-h-20 shrink-0 items-center justify-between gap-6 bg-background px-5 py-4 max-md:flex-col max-md:items-stretch">
      <div className="toolbar-identity flex min-w-0 items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center bg-primary text-primary-foreground">
          <TreesIcon />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <h1 className="font-heading font-medium text-xl tracking-tight">
            Workgrove
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="repository-switcher h-6 max-w-[52vw] justify-start px-0"
                  variant="ghost"
                />
              }
            >
              <strong>{repoName}</strong>
              <span className="truncate text-muted-foreground">
                · {mainWorktreePath}
              </span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-90">
              <DropdownMenuRadioGroup
                onValueChange={onSelectRepository}
                value={activeRepoPath}
              >
                <DropdownMenuLabel>Recent repositories</DropdownMenuLabel>
                {repositories.map((path) => (
                  <DropdownMenuRadioItem key={path} value={path}>
                    <span className="grid min-w-0 gap-0.5">
                      <strong>{repositoryName(path)}</strong>
                      <small className="truncate text-muted-foreground">
                        {path}
                      </small>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onConfigureCommands}>
                <Settings2Icon />
                Repository commands…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenRepository}>
                <FolderOpenIcon />
                Open another repository…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="toolbar-actions flex shrink-0 items-center gap-2">
        <Button onClick={onCreate} variant="secondary">
          <FolderPlusIcon data-icon="inline-start" />
          New worktree
        </Button>
        <Button
          aria-busy={isFetching}
          className="relative w-26 overflow-hidden"
          disabled={isFetching}
          onClick={onRefresh}
          variant="secondary"
        >
          <span
            className="refresh-progress bg-foreground/10"
            key={updatedAt}
            style={style}
          />
          <span className="relative inline-flex items-center gap-1.5">
            <RefreshCwIcon
              className={isFetching ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {isFetching ? "Refreshing" : "Refresh"}
          </span>
        </Button>
      </div>
    </header>
  );
}
