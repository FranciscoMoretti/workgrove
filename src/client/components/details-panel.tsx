import {
  CopyIcon,
  EraserIcon,
  GitBranchIcon,
  PlayIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { appsAreRunning } from "../../controller/workspace-snapshot";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
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
  if (app.probe === "none") {
    return "Port reserved · no health check";
  }
  if (app.ownership === "foreign") {
    return "Occupied by another process";
  }
  return app.listening ? "Listening" : "Not running";
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
  actionPending,
  clearPending,
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
  worktree,
}: {
  actionPending: boolean;
  clearPending: boolean;
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
                    {app.port}
                  </a>
                ) : (
                  <code>{app.port}</code>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <div className="detail-actions">
        <Button
          disabled={
            actionPending || (!running && worktree.slotState !== "assigned")
          }
          onClick={onToggleApps}
          variant={running ? "secondary" : "default"}
        >
          {running ? <SquareIcon /> : <PlayIcon />}
          {running ? "Stop apps" : "Start apps"}
        </Button>
        <WorktreeActionsMenu
          bordered
          commandActions={commandActions}
          onDelete={onDelete}
          onInspect={onInspect}
          pending={actionPending}
          worktree={worktree}
        />
      </div>
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
        <div className="terminal">
          {terminalContent({
            end,
            error,
            loading,
            logs,
            onRetry: onRetryLogs,
          })}
        </div>
      </section>
    </aside>
  );
}
