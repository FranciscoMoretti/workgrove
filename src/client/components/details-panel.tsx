import {
  ArrowUpRightIcon,
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
import { WorktreeConfigSourceSchema } from "../../config/worktree-config-source";
import type {
  AppGroupSnapshot,
  WorktreeConfigSource,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appsAreRunning } from "../../controller/workspace-snapshot";
import { codexNewTaskUrl, codexOpenTaskUrl } from "../codex-links";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppEndpointLink } from "./app-endpoint-link";
import { AppGroupInstanceControl } from "./app-group-instance-control";
import { worktreeDisplayStatus } from "./app-group-status";
import { StatusSummary } from "./status-summary";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Spinner } from "./ui/spinner";
import { WorktreeActionsMenu } from "./worktree-actions-menu";

function indicatorClass(app: WorktreeSnapshot["apps"][number]): string {
  if (app.ownership === "foreign") {
    return "size-1.5 rounded-full bg-destructive";
  }
  if (app.readiness === "ready") {
    return "size-1.5 rounded-full bg-status-running-foreground";
  }
  return app.listening
    ? "size-1.5 rounded-full bg-status-partial-foreground"
    : "size-1.5 rounded-full bg-muted-foreground/60";
}

function endpointStatus(app: WorktreeSnapshot["apps"][number]): string {
  if (app.ownership === "foreign") {
    return "Occupied by another process";
  }
  if (!app.listening) {
    return "Stopped";
  }
  if (app.readiness !== "ready") {
    return app.readiness === "waiting" ? "Waiting for readiness" : "Not ready";
  }
  if (app.protocol === "tcp" || app.routeState === "active") {
    return "Ready";
  }
  if (app.routeState === "conflict") {
    return "Ready · Route conflict";
  }
  if (app.routeState === "unavailable") {
    return "Ready · Route unavailable";
  }
  return "Ready · Route inactive";
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
  if (!task.activity || task.activity.state === "unknown") {
    return { className: "bg-muted-foreground", label: "Activity unknown" };
  }
  return { className: "bg-muted-foreground", label: "Ready" };
}

function taskTime(value: string): string {
  return new Date(value).toLocaleString();
}

function CodexTasksSection({
  discoveryUnavailable,
  loading,
  tasks,
  worktreePath,
}: {
  discoveryUnavailable: boolean;
  loading: boolean;
  tasks: CodexTaskSnapshot[];
  worktreePath: string;
}) {
  const newTaskUrl = codexNewTaskUrl(worktreePath);
  let content = (
    <p className="mt-2 text-muted-foreground text-sm">
      No Codex tasks associated with this worktree.
    </p>
  );
  if (discoveryUnavailable) {
    content = (
      <p className="mt-2 text-muted-foreground text-sm">
        Task discovery is temporarily unavailable. You can still start a new
        Codex task for this worktree.
      </p>
    );
  } else if (loading) {
    content = (
      <p className="mt-2 text-muted-foreground text-sm">
        Discovering Codex tasks…
      </p>
    );
  } else if (tasks.length > 0) {
    content = (
      <ScrollArea className="mt-2 h-44 border" scrollbars={["vertical"]}>
        <div className="divide-y">
          {tasks.map((task) => {
            const activity = codexActivity(task);
            const openTaskUrl = codexOpenTaskUrl(task.id);
            return (
              <div className="px-3 py-2.5" key={task.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
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
                        Updated {taskTime(task.updatedAt)}
                      </span>
                      {task.contextSharedAt ? (
                        <span className="text-muted-foreground text-xs">
                          Context shared {taskTime(task.contextSharedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {openTaskUrl ? (
                    <a
                      aria-label={`Open ${task.title} in Codex`}
                      className={buttonVariants({
                        size: "icon-xs",
                        variant: "ghost",
                      })}
                      href={openTaskUrl}
                      title="Open task in Codex"
                    >
                      <ArrowUpRightIcon />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  }
  return (
    <section className="codex-tasks-section">
      <div className="section-kicker">Collaboration</div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="flex items-center gap-1.5">
            <BotIcon className="size-4" />
            Codex tasks
          </h3>
          <Badge variant="outline">{tasks.length}</Badge>
        </div>
        {newTaskUrl ? (
          <a className={buttonVariants({ size: "sm" })} href={newTaskUrl}>
            New task
          </a>
        ) : null}
      </div>
      {content}
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
        <span>BranchBase will keep trying to reconnect.</span>
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

function WorktreeConfigurationSource({
  disabled,
  onSelect,
  worktree,
}: {
  disabled: boolean;
  onSelect: (source: WorktreeConfigSource) => void;
  worktree: WorktreeSnapshot;
}) {
  const { configuration } = worktree;
  const fallback = configuration.preference !== configuration.source;
  return (
    <section className="worktree-configuration-section">
      <div className="section-kicker">Configuration</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3>Configuration source</h3>
          <code className="block truncate text-muted-foreground text-xs">
            {configuration.path}
          </code>
        </div>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            const source = WorktreeConfigSourceSchema.safeParse(value);
            if (source.success && source.data !== configuration.preference) {
              onSelect(source.data);
            }
          }}
          value={configuration.preference}
        >
          <SelectTrigger
            aria-label="Configuration source"
            className="min-w-36"
            size="sm"
          >
            <SelectValue>
              {configuration.preference === "checkout"
                ? "This worktree"
                : "Project default"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="project-default">Project default</SelectItem>
              <SelectItem value="checkout">This worktree</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {fallback ? (
        <p className="mt-2 text-status-partial-foreground text-xs">
          Using Project default because the selected worktree configuration is
          unavailable.
        </p>
      ) : null}
      {configuration.error ? (
        <p className="mt-1 break-words text-destructive text-xs">
          {configuration.error}
        </p>
      ) : null}
    </section>
  );
}

export function DetailsPanel({
  actionBlocked,
  actionPending,
  appGroup,
  clearPending,
  configSourcePending,
  codexDiscoveryUnavailable = false,
  codexLoading = false,
  codexTasks = [],
  commandActions,
  error,
  loading,
  logs,
  onClearLogs,
  onClose,
  onCreateAppGroupInstance,
  onDelete,
  onInspect,
  onRetryLogs,
  onSelectConfigSource,
  onSelectAppGroupInstance,
  onToggleApps,
  worktreeActionPending,
  worktree,
}: {
  actionBlocked: boolean;
  actionPending: boolean;
  appGroup: AppGroupSnapshot;
  clearPending: boolean;
  configSourcePending: boolean;
  codexDiscoveryUnavailable?: boolean;
  codexLoading?: boolean;
  codexTasks?: CodexTaskSnapshot[];
  commandActions: WorktreeCommandActions;
  error: Error | null;
  loading: boolean;
  logs: string[];
  onClearLogs: () => void;
  onClose: () => void;
  onCreateAppGroupInstance: (name: string) => Promise<void>;
  onDelete: () => void;
  onInspect: () => void;
  onRetryLogs: () => void;
  onSelectConfigSource: (source: WorktreeConfigSource) => void;
  onSelectAppGroupInstance: (instanceId: string) => void;
  onToggleApps: () => void;
  worktreeActionPending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const end = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const running = appsAreRunning(worktree);
  const displayStatus = worktreeDisplayStatus(worktree);
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
    <aside
      className="details-panel flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-status={displayStatus}
    >
      <header>
        <div className="min-w-0">
          <span className="detail-eyebrow">Selected worktree</span>
          <div className="flex min-w-0 items-center gap-3">
            <h2>{worktree.name}</h2>
            <StatusSummary status={displayStatus} />
          </div>
          <div className="detail-metadata flex flex-wrap gap-1.5">
            <Badge variant="outline">
              <GitBranchIcon />
              {worktree.branch}
            </Badge>
            <span className="detail-path" title={worktree.path}>
              {worktree.path}
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
      <WorktreeConfigurationSource
        disabled={configSourcePending || worktree.configuration.changeBlocked}
        onSelect={onSelectConfigSource}
        worktree={worktree}
      />
      <section className="apps-section">
        <div className="section-kicker">App group</div>
        <div className="app-group-detail-heading">
          <h3>{appGroup.name}</h3>
          {appGroup.instance.mode === "selectable" ? (
            <div className="app-group-instance-control">
              <AppGroupInstanceControl
                disabled={actionBlocked}
                group={appGroup}
                onCreate={onCreateAppGroupInstance}
                onSelect={onSelectAppGroupInstance}
              />
            </div>
          ) : null}
        </div>
        <div className="apps-grid grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
          {worktree.apps.map((app) => (
            <Card
              className="app-card"
              data-app-state={endpointStatus(app).toLowerCase()}
              key={app.id}
              size="sm"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className={indicatorClass(app)} />
                  {app.label}
                </CardTitle>
                <CardDescription>{endpointStatus(app)}</CardDescription>
              </CardHeader>
              <CardContent>
                <AppEndpointLink app={app} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <div className="detail-actions">
        <Button
          disabled={actionBlocked}
          onClick={onToggleApps}
          variant={running ? "secondary" : "default"}
        >
          {lifecycleActionIcon(actionPending, running)}
          {running ? "Stop apps" : "Start apps"}
        </Button>
        <WorktreeActionsMenu
          bordered
          commandActions={commandActions}
          includeLifecycle={false}
          onDelete={onDelete}
          onInspect={onInspect}
          pending={worktreeActionPending}
          worktree={worktree}
        />
      </div>
      <CodexTasksSection
        discoveryUnavailable={codexDiscoveryUnavailable}
        loading={codexLoading}
        tasks={codexTasks}
        worktreePath={worktree.path}
      />
      <section className="terminal-section">
        <div className="section-kicker">Output</div>
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
