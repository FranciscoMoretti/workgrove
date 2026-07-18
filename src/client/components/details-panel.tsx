import {
  BotIcon,
  Clock3Icon,
  CopyIcon,
  EraserIcon,
  GitBranchIcon,
  PlayIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodexTaskSnapshot } from "../../codex/codex-integration";
import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { appsAreRunning } from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppPort } from "./app-port";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import { WorktreeActionsMenu } from "./worktree-actions-menu";

function indicatorClass(app: WorktreeSnapshot["apps"][number]): string {
  if (app.listening) {
    return "size-1.5 rounded-full bg-foreground";
  }
  return app.ownership === "foreign"
    ? "size-1.5 rounded-full bg-destructive"
    : "size-1.5 rounded-full bg-muted-foreground/60";
}

function endpointStatus(app: WorktreeSnapshot["apps"][number]): string {
  if (app.ownership === "foreign") {
    return "Occupied by another process";
  }
  return app.listening ? "Listening" : "Not running";
}

function lifecycleActionIcon(pending: boolean, running: boolean) {
  if (pending) {
    return <Spinner />;
  }
  return running ? <SquareIcon /> : <PlayIcon />;
}

function codexActivity(task: CodexTaskSnapshot): {
  className: string;
  label: string;
} {
  if (task.activity?.state === "working") {
    return { className: "bg-status-running-foreground", label: "Working" };
  }
  if (task.activity?.state === "waiting-for-approval") {
    return {
      className: "bg-status-partial-foreground",
      label: "Waiting approval",
    };
  }
  if (task.activity?.state === "unknown") {
    return { className: "bg-muted-foreground", label: "Activity unknown" };
  }
  return { className: "bg-muted-foreground", label: "Ready" };
}

function CodexTasksSection({ tasks }: { tasks: CodexTaskSnapshot[] }) {
  return (
    <section className="codex-tasks-section">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5">
          <BotIcon className="size-4" />
          Codex tasks
        </h3>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>
      {tasks.length > 0 ? (
        <ScrollArea className="mt-2 h-44 border" scrollbars={["vertical"]}>
          <div className="divide-y">
            {tasks.map((task) => {
              const activity = codexActivity(task);
              return (
                <div className="px-3 py-2.5" key={task.id}>
                  <div className="truncate font-medium text-sm">
                    {task.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <span
                        className={`size-1.5 rounded-full ${activity.className}`}
                      />
                      {activity.label}
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                      <Clock3Icon className="size-3" />
                      {new Date(task.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">
          No Codex tasks associated with this worktree.
        </p>
      )}
    </section>
  );
}

function terminalContent({
  end,
  error,
  loading,
  logs,
  onRetry,
}: {
  end: React.RefObject<HTMLSpanElement | null>;
  error: Error | null;
  loading: boolean;
  logs: readonly string[];
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="terminal-state">
        <Spinner />
        <span>Connecting to managed logs…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="terminal-state error">
        <strong>Logs temporarily unavailable</strong>
        <span>Workgrove will keep trying to reconnect.</span>
        <Button
          className="terminal-retry"
          onClick={onRetry}
          size="sm"
          variant="ghost"
        >
          Retry now
        </Button>
      </div>
    );
  }
  if (logs.length === 0) {
    return (
      <div className="terminal-state terminal-empty">
        <strong>No output yet</strong>
        <span>Start apps to stream their managed output here.</span>
      </div>
    );
  }
  return (
    <pre>
      {logs.join("\n")}
      <span ref={end} />
    </pre>
  );
}

export function DetailsPanel({
  actionBlocked,
  actionPending,
  clearPending,
  codexTasks = [],
  commandActions,
  error,
  loading,
  logs,
  onClearLogs,
  onClose,
  onDelete,
  onInspect,
  onRetryLogs,
  onToggleApps,
  worktreeActionPending,
  worktree,
}: {
  actionBlocked: boolean;
  actionPending: boolean;
  clearPending: boolean;
  codexTasks?: CodexTaskSnapshot[];
  commandActions: WorktreeCommandActions;
  error: Error | null;
  loading: boolean;
  logs: string[];
  onClearLogs: () => void;
  onClose: () => void;
  onDelete: () => void;
  onInspect: () => void;
  onRetryLogs: () => void;
  onToggleApps: () => void;
  worktreeActionPending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const end = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const running = appsAreRunning(worktree);
  const logCount = logs.length;
  const latestLog = logs.at(-1);
  useEffect(() => {
    if (logCount > 0 && latestLog !== undefined) {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [latestLog, logCount]);
  async function copy() {
    await navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <aside className="details-panel flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <header>
        <div className="min-w-0">
          <h2>{worktree.name}</h2>
          <p>{worktree.path}</p>
          <div className="detail-metadata flex flex-wrap gap-1.5">
            <Badge variant="outline">
              <GitBranchIcon />
              {worktree.branch}
            </Badge>
            <Badge variant="outline">
              {worktree.slot === null
                ? "Unassigned"
                : `App slot ${worktree.slot}`}
            </Badge>
          </div>
        </div>
        <Button
          aria-label="Close details"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </header>
      <section className="apps-section">
        <h3>Apps</h3>
        <div className="apps-grid grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
          {worktree.apps.map((app) => (
            <Card key={app.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className={indicatorClass(app)} />
                  {app.label}
                </CardTitle>
                <CardDescription>{endpointStatus(app)}</CardDescription>
              </CardHeader>
              <CardContent>
                {app.open && app.listening ? (
                  <a
                    className="underline underline-offset-3"
                    href={app.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <AppPort port={app.port} />
                  </a>
                ) : (
                  <AppPort port={app.port} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <div className="detail-actions">
        <Button
          disabled={
            actionBlocked || (!running && worktree.slotState !== "assigned")
          }
          onClick={onToggleApps}
          variant={running ? "secondary" : "default"}
        >
          {lifecycleActionIcon(actionPending, running)}
          {running ? "Stop apps" : "Start apps"}
        </Button>
        <WorktreeActionsMenu
          bordered
          commandActions={commandActions}
          onDelete={onDelete}
          onInspect={onInspect}
          pending={worktreeActionPending}
          worktree={worktree}
        />
      </div>
      <CodexTasksSection tasks={codexTasks} />
      <section className="terminal-section">
        <div className="section-title">
          <h3>Managed logs</h3>
          <div className="terminal-actions">
            <Button
              disabled={logs.length === 0}
              onClick={copy}
              size="sm"
              variant="secondary"
            >
              <CopyIcon />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              disabled={logs.length === 0 || clearPending}
              onClick={onClearLogs}
              size="sm"
              variant="secondary"
            >
              <EraserIcon />
              Clear
            </Button>
          </div>
        </div>
        <ScrollArea
          className="terminal"
          scrollbars={["vertical", "horizontal"]}
        >
          {terminalContent({
            end,
            error,
            loading,
            logs,
            onRetry: onRetryLogs,
          })}
        </ScrollArea>
      </section>
    </aside>
  );
}
