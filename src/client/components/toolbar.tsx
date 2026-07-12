import {
  ChevronDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  TreesIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import type { GlobalProcessSnapshot } from "../../controller/workspace-snapshot";
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
  globalProcesses,
  isFetching,
  mainWorktreePath,
  onCreate,
  onOpenRepository,
  onRefresh,
  onSelectRepository,
  recentRepositories,
  repoName,
  updatedAt,
}: {
  activeRepoPath: string;
  globalProcesses: GlobalProcessSnapshot[];
  isFetching: boolean;
  mainWorktreePath: string;
  onCreate: () => void;
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
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">
          <TreesIcon />
        </span>
        <div className="brand-copy">
          <h1>Workgrove</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="repository-switcher" variant="ghost">
                <strong>{repoName}</strong>
                <span>· {mainWorktreePath}</span>
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="repository-menu">
              <DropdownMenuLabel>Recent repositories</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={onSelectRepository}
                value={activeRepoPath}
              >
                {repositories.map((path) => (
                  <DropdownMenuRadioItem key={path} value={path}>
                    <span className="repository-option">
                      <strong>{repositoryName(path)}</strong>
                      <small>{path}</small>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenRepository}>
                <FolderOpenIcon />
                Open another repository…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="toolbar-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="global-process-count" variant="ghost">
              {globalProcesses.length} running globally
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="global-process-menu">
            <DropdownMenuLabel>Managed processes</DropdownMenuLabel>
            {globalProcesses.length === 0 ? (
              <p className="global-process-empty">No apps are running.</p>
            ) : (
              globalProcesses.map((process) => (
                <div className="global-process-item" key={process.pid}>
                  <strong>{process.label}</strong>
                  <span>PID {process.pid}</span>
                  <code>{process.argv.join(" ")}</code>
                  <small>{process.cwd}</small>
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={onCreate} variant="secondary">
          <FolderPlusIcon />
          New worktree
        </Button>
        <Button
          aria-busy={isFetching}
          className="refresh-button"
          disabled={isFetching}
          onClick={onRefresh}
          variant="secondary"
        >
          <span className="refresh-progress" key={updatedAt} style={style} />
          <span className="button-content">
            <RefreshCwIcon className={isFetching ? "spin" : ""} />
            {isFetching ? "Refreshing" : "Refresh"}
          </span>
        </Button>
      </div>
    </header>
  );
}
