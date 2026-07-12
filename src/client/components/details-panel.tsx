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
import { Button } from "./ui/button";
import { WorktreeActionsMenu } from "./worktree-actions-menu";

function indicatorClass(app: WorktreeSnapshot["apps"][number]): string {
  if (app.listening) {
    return "mini-dot on";
  }
  return app.ownership === "foreign" ? "mini-dot conflict" : "mini-dot";
}

function endpointStatus(app: WorktreeSnapshot["apps"][number]): string {
  if (app.probe === "none") {
    return "Reserved · not probed";
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
    return <p>Connecting to managed logs…</p>;
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
      <p>
        No managed output yet. Start apps from Workgrove to capture logs here.
      </p>
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
  error,
  loading,
  logs,
  onClearLogs,
  onClose,
  onDelete,
  onInspect,
  onRestart,
  onRetryLogs,
  onToggleApps,
  worktree,
}: {
  actionPending: boolean;
  clearPending: boolean;
  error: Error | null;
  loading: boolean;
  logs: string[];
  onClearLogs: () => void;
  onClose: () => void;
  onDelete: () => void;
  onInspect: () => void;
  onRestart: () => void;
  onRetryLogs: () => void;
  onToggleApps: () => void;
  worktree: WorktreeSnapshot;
}) {
  const end = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const running = appsAreRunning(worktree);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }));
  async function copy() {
    await navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <aside className="details-panel">
      <header>
        <div>
          <h2>{worktree.name}</h2>
          <p>{worktree.path}</p>
          <div className="detail-meta">
            <span>
              <GitBranchIcon />
              {worktree.branch}
            </span>
            <span>
              {worktree.slot === null
                ? "Unassigned"
                : `App slot ${worktree.slot}`}
            </span>
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
      <section>
        <h3>Configured apps</h3>
        <div className="endpoint-grid">
          {worktree.apps.map((app) => (
            <div className="endpoint-card" key={app.id}>
              <div>
                <span className={indicatorClass(app)} />
                <strong>{app.label}</strong>
              </div>
              {app.open && app.listening ? (
                <a href={app.url} rel="noreferrer" target="_blank">
                  {app.port}
                </a>
              ) : (
                <code>{app.port}</code>
              )}
              <small>{endpointStatus(app)}</small>
            </div>
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
          onDelete={onDelete}
          onInspect={onInspect}
          onRestart={onRestart}
          pending={actionPending}
          worktree={worktree}
        />
      </div>
      <section className="terminal-section">
        <div className="section-title">
          <h3>Managed terminal</h3>
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
