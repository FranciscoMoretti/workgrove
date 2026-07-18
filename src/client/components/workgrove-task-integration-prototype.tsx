// PROTOTYPE — the selected Workgrove table and right-hand inspector model.
// Development-only: ?integrationVariant=C renders representative Codex task
// data alongside the existing worktree/runtime model.

import {
  ArrowUpRightIcon,
  BotIcon,
  CircleDotIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GitBranchIcon,
  Globe2Icon,
  ListTreeIcon,
  PlusIcon,
  RadioIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import type {
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appGroupIsRunning } from "../../controller/workspace-snapshot";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export type IntegrationPrototypeVariant = "C";
type TaskState = "ready" | "waiting" | "working";

interface PrototypeTask {
  activity: TaskState;
  id: string;
  title: string;
  updated: string;
}

interface Record {
  logs: string[];
  tasks: PrototypeTask[];
  worktree: WorktreeSnapshot;
}

const PRIMARY_TASKS: PrototypeTask[] = [
  {
    activity: "working",
    id: "task-feature-live",
    title: "Continue Codex-aware worktree integration",
    updated: "2 min ago",
  },
  {
    activity: "waiting",
    id: "task-hook-bridge",
    title: "Review lifecycle hook bridge",
    updated: "18 min ago",
  },
  {
    activity: "ready",
    id: "task-direct-links",
    title: "Validate direct Codex links",
    updated: "1 hr ago",
  },
  {
    activity: "ready",
    id: "task-layouts",
    title: "Compare task layouts",
    updated: "Yesterday",
  },
];

const SECONDARY_TASKS: PrototypeTask[] = [
  {
    activity: "ready",
    id: "task-preview-routes",
    title: "Trace preview route ownership",
    updated: "34 min ago",
  },
  {
    activity: "ready",
    id: "task-config-review",
    title: "Review worktree configuration",
    updated: "3 days ago",
  },
];

const LOGS = [
  "10:42:18  web     ready on :4317",
  "10:42:19  router  preview route registered",
  "10:42:20  api     connected to local database",
  "10:43:04  web     GET /api/worktrees 200 24ms",
  "10:43:12  worker  stopped",
];

function recordsFromWorkspace(workspace: WorkspaceSnapshot): Record[] {
  const first = workspace.worktrees[0];
  if (!first) {
    return [];
  }
  const branches = [
    "feature/codex-links",
    "fix/task-discovery",
    "chore/plugin-bridge",
  ];
  const worktrees = [...workspace.worktrees];
  while (worktrees.length < 4) {
    const branch = branches[worktrees.length - 1];
    worktrees.push({
      ...first,
      branch,
      id: `table-prototype-${worktrees.length}`,
      isMain: false,
      name: branch.replace("/", "-"),
      path: `${workspace.repoPath}/.worktrees/${branch.replace("/", "-")}`,
    });
  }
  return worktrees.slice(0, 4).map((worktree, index) => {
    let tasks: PrototypeTask[] = [];
    if (index === 0) {
      tasks = PRIMARY_TASKS;
    } else if (index === 1) {
      tasks = SECONDARY_TASKS;
    }
    const recordWorktree =
      index === 0
        ? {
            ...worktree,
            appGroups: worktree.appGroups.map((group) => ({
              ...group,
              apps: group.apps.map((app) => ({
                ...app,
                listening: true,
                open: true as const,
              })),
              health: "running" as const,
              processRunning: true,
            })),
          }
        : worktree;
    return { logs: index === 0 ? LOGS : [], tasks, worktree: recordWorktree };
  });
}

function taskIndicator(state: TaskState) {
  if (state === "working") {
    return { className: "bg-status-running-foreground", label: "Working" };
  }
  if (state === "waiting") {
    return {
      className: "bg-status-partial-foreground",
      label: "Waiting approval",
    };
  }
  return { className: "bg-muted-foreground", label: "Ready" };
}

function TaskStateMark({ state }: { state: TaskState }) {
  const copy = taskIndicator(state);
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className={`size-1.5 rounded-full ${copy.className}`} />
      {copy.label}
    </span>
  );
}

function TaskSummary({ tasks }: { tasks: PrototypeTask[] }) {
  const live = tasks.filter((task) => task.activity === "working").length;
  const waiting = tasks.filter((task) => task.activity === "waiting").length;
  if (tasks.length === 0) {
    return <span className="text-muted-foreground text-xs">No tasks</span>;
  }
  return (
    <div className="flex min-w-[9rem] flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="outline">
        <BotIcon />
        {tasks.length}
      </Badge>
      {live > 0 ? (
        <span className="inline-flex items-center gap-1 text-status-running-foreground text-xs">
          <span className="size-1.5 rounded-full bg-current" />
          {live} live
        </span>
      ) : null}
      {waiting > 0 ? (
        <span className="inline-flex items-center gap-1 text-status-partial-foreground text-xs">
          <span className="size-1.5 rounded-full bg-current" />
          {waiting} waiting
        </span>
      ) : null}
      {live === 0 && waiting === 0 ? (
        <span className="text-muted-foreground text-xs">All ready</span>
      ) : null}
    </div>
  );
}

function RuntimeSummary({ worktree }: { worktree: WorktreeSnapshot }) {
  const running = worktree.appGroups.filter(appGroupIsRunning).length;
  return (
    <div className="flex min-w-[12rem] flex-wrap gap-x-3 gap-y-1">
      {worktree.appGroups.map((group) => (
        <span className="flex items-center gap-1.5 text-xs" key={group.name}>
          <span
            className={
              appGroupIsRunning(group)
                ? "size-1.5 rounded-full bg-status-running-foreground"
                : "size-1.5 rounded-full bg-muted-foreground/60"
            }
          />
          <span className="font-medium">{group.name}</span>
        </span>
      ))}
      {worktree.appGroups.length === 0 ? (
        <span className="text-muted-foreground text-xs">No app groups</span>
      ) : null}
      <span className="sr-only">{running} running app groups</span>
    </div>
  );
}

function WorktreeOverview({
  records,
  selectedId,
  setSelectedId,
}: {
  records: Record[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}) {
  return (
    <ScrollArea
      className="h-full min-w-0 border bg-card"
      scrollbars={["vertical", "horizontal"]}
    >
      <Table
        className="min-w-[820px]"
        containerClassName="w-max min-w-full overflow-visible"
      >
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-[25%]">Worktree</TableHead>
            <TableHead className="w-[17%]">Branch</TableHead>
            <TableHead>App groups</TableHead>
            <TableHead className="w-[16%]">Codex tasks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const { worktree } = record;
            return (
              <TableRow
                className="cursor-pointer"
                data-state={selectedId === worktree.id ? "selected" : undefined}
                key={worktree.id}
                onClick={() => setSelectedId(worktree.id)}
              >
                <TableCell>
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <strong>{worktree.name}</strong>
                      {worktree.isMain ? (
                        <Badge variant="secondary">Main</Badge>
                      ) : null}
                    </div>
                    <span className="max-w-72 truncate font-mono text-muted-foreground text-xs">
                      {worktree.path}
                    </span>
                    {worktree.setupState === "failed" ? (
                      <Badge className="w-fit" variant="destructive">
                        Setup failed
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-muted-foreground text-xs">
                    <GitBranchIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{worktree.branch}</span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <RuntimeSummary worktree={worktree} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <TaskSummary tasks={record.tasks} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function AppLinks({ record }: { record: Record }) {
  const apps = record.worktree.appGroups.flatMap((group) =>
    group.apps.map((app) => ({ app, group }))
  );
  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-[0.12em]">
          <Globe2Icon className="size-3.5" />
          Running apps
        </h3>
        <span className="text-muted-foreground text-xs">
          {apps.filter(({ app }) => app.listening).length}/{apps.length}{" "}
          listening
        </span>
      </div>
      <div className="grid gap-2">
        {apps.map(({ app, group }) => (
          <div
            className="flex items-center justify-between gap-3 border bg-muted/15 px-3 py-2"
            key={app.id}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className={
                    app.listening
                      ? "size-1.5 rounded-full bg-status-running-foreground"
                      : "size-1.5 rounded-full bg-muted-foreground/60"
                  }
                />
                <span className="font-medium">{app.label}</span>
                <span className="text-muted-foreground">· {group.name}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {app.url}
              </div>
            </div>
            {app.open && app.listening ? (
              <a
                aria-label={`Open ${app.label}`}
                className="inline-flex size-7 shrink-0 items-center justify-center border hover:bg-muted"
                href={app.url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ) : null}
          </div>
        ))}
        {apps.length === 0 ? (
          <div className="border border-dashed p-3 text-center text-muted-foreground text-xs">
            No app endpoints configured.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CodexTasks({
  record,
  showAction,
}: {
  record: Record;
  showAction: (message: string) => void;
}) {
  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-[0.12em]">
            <BotIcon className="size-3.5" />
            Codex tasks
          </h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {record.tasks.length} associated · newest first
          </p>
        </div>
        <Button
          onClick={() =>
            showAction(`Would open a new Codex task at ${record.worktree.path}`)
          }
          size="sm"
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </div>
      {record.tasks.length > 0 ? (
        <div className="divide-y border">
          {record.tasks.map((task) => (
            <Button
              className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] justify-stretch gap-3 whitespace-normal rounded-none px-3 py-2.5 text-left"
              key={task.id}
              onClick={() =>
                showAction(`Would open Codex task “${task.title}”`)
              }
              variant="ghost"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{task.title}</div>
                <div className="mt-1 flex items-center gap-2">
                  <TaskStateMark state={task.activity} />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock3Icon className="size-3" />
                    {task.updated}
                  </span>
                </div>
              </div>
              <ArrowUpRightIcon className="mt-1 size-3.5 text-muted-foreground" />
            </Button>
          ))}
        </div>
      ) : (
        <div className="border border-dashed p-4 text-center text-muted-foreground text-xs">
          No associated tasks. Start one here to keep its worktree context.
        </div>
      )}
    </section>
  );
}

function Console({ record }: { record: Record }) {
  return (
    <section className="min-h-[11rem] bg-[#121513] p-4 text-[#b9c5bc]">
      <div className="mb-2 flex items-center justify-between text-[#d8e2da]">
        <h3 className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-[0.12em]">
          <TerminalSquareIcon className="size-3.5" />
          Managed console
        </h3>
        <span className="flex items-center gap-1 text-[#8fa595] text-[11px]">
          <RadioIcon className="size-3" /> Live
        </span>
      </div>
      <div className="font-mono text-[11px]">
        {record.logs.length > 0 ? (
          record.logs.map((line) => (
            <div className="mb-1 break-all" key={line}>
              {line}
            </div>
          ))
        ) : (
          <p className="text-[#758078]">No managed output yet.</p>
        )}
      </div>
    </section>
  );
}

function WorktreeInspector({
  onClose,
  record,
  showAction,
}: {
  onClose: () => void;
  record: Record;
  showAction: (message: string) => void;
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border bg-background shadow-[0_14px_36px_-28px_color-mix(in_oklch,var(--foreground),transparent_25%)]">
      <header className="flex items-start justify-between gap-3 border-b bg-[linear-gradient(115deg,color-mix(in_oklch,var(--muted),transparent_36%),transparent_62%)] p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            <CircleDotIcon className="size-3.5" />
            Worktree inspector
          </div>
          <h2 className="mt-1 truncate font-semibold text-lg">
            {record.worktree.name}
          </h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate font-mono text-muted-foreground text-xs">
            <GitBranchIcon className="size-3.5 shrink-0" />
            {record.worktree.branch}
          </p>
        </div>
        <Button
          aria-label="Close worktree inspector"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <AppLinks record={record} />
        <CodexTasks record={record} showAction={showAction} />
        <Console record={record} />
      </ScrollArea>
    </aside>
  );
}

export function integrationPrototypeVariantFromSearch(
  search: string
): IntegrationPrototypeVariant | null {
  return new URLSearchParams(search).get("integrationVariant") === "C"
    ? "C"
    : null;
}

export function WorkgroveTaskIntegrationPrototype({
  workspace,
}: {
  initialVariant: IntegrationPrototypeVariant;
  workspace: WorkspaceSnapshot;
}) {
  const records = recordsFromWorkspace(workspace);
  const [selectedId, setSelectedId] = useState<string | null>(
    records[0]?.worktree.id ?? null
  );
  const [action, setAction] = useState<string | null>(null);
  const selected =
    records.find((record) => record.worktree.id === selectedId) ?? records[0];
  if (!selected) {
    return null;
  }
  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <header className="flex items-center justify-between gap-4 border bg-[linear-gradient(115deg,color-mix(in_oklch,var(--muted),transparent_35%),transparent_62%)] px-4 py-3 shadow-[0_1px_0_color-mix(in_oklch,var(--foreground),transparent_90%)]">
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-[0.16em]">
              <ListTreeIcon className="size-3.5" />
              Worktree overview
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Runtime stays visible in the table; inspect a worktree for its
              apps, Codex tasks, and managed console.
            </p>
          </div>
          <Badge className="hidden shrink-0 sm:flex" variant="outline">
            Table + inspector
          </Badge>
        </header>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(11rem,0.8fr)_minmax(0,1.2fr)] gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.8fr)] lg:grid-rows-1">
          <WorktreeOverview
            records={records}
            selectedId={selected.worktree.id}
            setSelectedId={setSelectedId}
          />
          <WorktreeInspector
            onClose={() => setSelectedId(null)}
            record={selected}
            showAction={setAction}
          />
        </div>
      </div>
      {action ? (
        <Button
          className="fixed right-4 bottom-4 z-50 h-auto max-w-sm justify-start whitespace-normal border bg-background px-4 py-3 text-left shadow-lg"
          onClick={() => setAction(null)}
          variant="outline"
        >
          <span className="block font-medium text-xs">Prototype action</span>
          <span className="mt-0.5 block text-muted-foreground text-xs">
            {action}
          </span>
        </Button>
      ) : null}
    </>
  );
}
