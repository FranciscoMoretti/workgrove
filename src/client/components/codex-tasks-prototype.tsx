// PROTOTYPE — three variants of the existing workspace page, switchable with
// ?codexVariant=A|B|C. This is throwaway UI for deciding how every associated
// Codex task, Live activity, Open task, and New task should fit Workgrove.

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  Clock3Icon,
  GitBranchIcon,
  ListTreeIcon,
  MessageSquareIcon,
  PlusIcon,
  RadioIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export type CodexPrototypeVariant = "A" | "B" | "C";
type ActivityState = "ready" | "unknown" | "waiting" | "working";

interface PrototypeTask {
  activity: ActivityState;
  contextShared: string | null;
  id: string;
  subagentCount: number;
  title: string;
  updated: string;
}

interface PrototypeWorktree {
  available: boolean;
  tasks: PrototypeTask[];
  worktree: WorktreeSnapshot;
}

interface PrototypeProps {
  records: PrototypeWorktree[];
  selectedTaskId: string | null;
  selectedWorktreeId: string | null;
  setSelectedTaskId: (id: string) => void;
  setSelectedWorktreeId: (id: string) => void;
  showAction: (message: string) => void;
}

const VARIANTS: Array<{
  key: CodexPrototypeVariant;
  name: string;
}> = [
  { key: "A", name: "Inline focus" },
  { key: "B", name: "Task rail" },
  { key: "C", name: "Activity ledger" },
];

const FEATURE_TASKS: PrototypeTask[] = [
  {
    activity: "working",
    contextShared: "2 min ago",
    id: "task-feature-live",
    subagentCount: 2,
    title: "Continue Codex-aware worktree integration",
    updated: "2 min ago",
  },
  {
    activity: "waiting",
    contextShared: "18 min ago",
    id: "task-hook-bridge",
    subagentCount: 0,
    title: "Review lifecycle hook bridge",
    updated: "18 min ago",
  },
  {
    activity: "ready",
    contextShared: "1 hr ago",
    id: "task-direct-links",
    subagentCount: 0,
    title: "Validate direct Codex links",
    updated: "1 hr ago",
  },
  {
    activity: "unknown",
    contextShared: null,
    id: "task-layouts",
    subagentCount: 0,
    title: "Compare task layouts",
    updated: "Yesterday",
  },
];

const SECONDARY_TASKS: PrototypeTask[] = [
  {
    activity: "ready",
    contextShared: "34 min ago",
    id: "task-preview-routes",
    subagentCount: 0,
    title: "Trace preview route ownership",
    updated: "34 min ago",
  },
  {
    activity: "unknown",
    contextShared: null,
    id: "task-config-review",
    subagentCount: 0,
    title: "Review worktree configuration",
    updated: "3 days ago",
  },
];

const ACTIVITY_COPY: Record<
  ActivityState,
  { className: string; label: string }
> = {
  ready: {
    className: "border-border bg-secondary text-secondary-foreground",
    label: "Ready",
  },
  unknown: {
    className: "border-border bg-background text-muted-foreground",
    label: "Unknown",
  },
  waiting: {
    className:
      "border-status-partial-foreground/30 bg-status-partial text-status-partial-foreground",
    label: "Waiting approval",
  },
  working: {
    className:
      "border-status-running-foreground/30 bg-status-running text-status-running-foreground",
    label: "Working",
  },
};

function prototypeRecords(workspace: WorkspaceSnapshot): PrototypeWorktree[] {
  const firstWorktree = workspace.worktrees[0];
  if (!firstWorktree) {
    return [];
  }
  const fixtureBranches = [
    "feature/codex-links",
    "fix/task-discovery",
    "chore/plugin-bridge",
  ];
  const worktrees = [...workspace.worktrees];
  while (worktrees.length < 4) {
    const branch = fixtureBranches[worktrees.length - 1];
    worktrees.push({
      ...firstWorktree,
      branch,
      id: `prototype-worktree-${worktrees.length}`,
      isMain: false,
      name: branch.replace("/", "-"),
      path: `${workspace.repoPath}/.worktrees/${branch.replace("/", "-")}`,
    });
  }
  return worktrees.slice(0, 4).map((worktree, index) => {
    if (index === 0) {
      return { available: true, tasks: FEATURE_TASKS, worktree };
    }
    if (index === 1) {
      return { available: true, tasks: SECONDARY_TASKS, worktree };
    }
    if (index === 3) {
      return { available: false, tasks: [], worktree };
    }
    return { available: true, tasks: [], worktree };
  });
}

function ActivityBadge({ state }: { state: ActivityState }) {
  const copy = ACTIVITY_COPY[state];
  return (
    <Badge className={copy.className} variant="outline">
      <span className="relative flex size-1.5">
        {state === "working" ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-45" />
        ) : null}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {copy.label}
    </Badge>
  );
}

function WorktreeIdentity({ worktree }: { worktree: WorktreeSnapshot }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <strong className="truncate">{worktree.name}</strong>
        {worktree.isMain ? <Badge variant="secondary">Main</Badge> : null}
      </div>
      <span className="mt-1 flex items-center gap-1.5 truncate font-mono text-muted-foreground text-xs">
        <GitBranchIcon className="size-3.5 shrink-0" />
        {worktree.branch}
      </span>
    </div>
  );
}

function TaskButton({
  compact = false,
  onOpen,
  selected = false,
  task,
}: {
  compact?: boolean;
  onOpen: () => void;
  selected?: boolean;
  task: PrototypeTask;
}) {
  return (
    <Button
      className={`h-auto w-full justify-start whitespace-normal rounded-none border-l-2 px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-l-foreground bg-muted/70"
          : "border-l-transparent hover:border-l-border hover:bg-muted/40"
      }`}
      onClick={onOpen}
      type="button"
      variant="ghost"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Clock3Icon className="size-3" />
              {task.updated}
            </span>
            {task.subagentCount > 0 ? (
              <span>{task.subagentCount} subagents</span>
            ) : null}
            {compact ? null : (
              <span>
                {task.contextShared
                  ? `Context shared ${task.contextShared}`
                  : "No shared context"}
              </span>
            )}
          </div>
        </div>
        <ActivityBadge state={task.activity} />
      </div>
    </Button>
  );
}

function TaskActions({
  showAction,
  task,
}: {
  showAction: (message: string) => void;
  task: PrototypeTask;
}) {
  return (
    <Button
      onClick={(event) => {
        event.stopPropagation();
        showAction(`Open “${task.title}” in Codex`);
      }}
      size="sm"
      variant="outline"
    >
      Open task
      <ArrowUpRightIcon />
    </Button>
  );
}

function NewTaskButton({
  showAction,
  worktree,
}: {
  showAction: (message: string) => void;
  worktree: WorktreeSnapshot;
}) {
  return (
    <Button
      onClick={() => showAction(`Start a new Codex task in ${worktree.name}`)}
      size="sm"
    >
      <PlusIcon />
      New task
    </Button>
  );
}

function EmptyTasks({
  available,
  showAction,
  worktree,
}: {
  available: boolean;
  showAction: (message: string) => void;
  worktree: WorktreeSnapshot;
}) {
  if (!available) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <ShieldAlertIcon className="size-4" />
          Codex tasks unavailable
        </span>
        <Button
          onClick={() => showAction("Retry Codex task discovery")}
          size="sm"
          variant="ghost"
        >
          <RefreshCwIcon />
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm">
      <span className="text-muted-foreground">No Codex tasks yet</span>
      <NewTaskButton showAction={showAction} worktree={worktree} />
    </div>
  );
}

function VariantA({
  records,
  selectedTaskId,
  selectedWorktreeId,
  setSelectedTaskId,
  setSelectedWorktreeId,
  showAction,
}: PrototypeProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PrototypeHeading
        description="Keep the existing table compact. The latest task acts as a spotlight; selecting a worktree expands its complete task history inline."
        label="Inline focus"
      />
      <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-card">
        <Table className="min-w-[1120px]">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead>Worktree</TableHead>
              <TableHead>App groups</TableHead>
              <TableHead className="w-[40%]">Codex</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => {
              const expanded = selectedWorktreeId === record.worktree.id;
              const latest = record.tasks[0];
              return (
                <TableRow
                  className="cursor-default align-top"
                  data-state={expanded ? "selected" : undefined}
                  key={record.worktree.id}
                  onClick={() => setSelectedWorktreeId(record.worktree.id)}
                >
                  <TableCell>
                    <WorktreeIdentity worktree={record.worktree} />
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-1 text-sm">
                      {record.worktree.appGroups.map((group) => (
                        <span key={group.name}>{group.name}</span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {record.tasks.length > 0 && latest ? (
                      <div className="min-w-[28rem]">
                        {expanded ? (
                          <div className="divide-y rounded-lg border bg-background">
                            {record.tasks.map((task) => (
                              <TaskButton
                                compact
                                key={task.id}
                                onOpen={() => setSelectedTaskId(task.id)}
                                selected={selectedTaskId === task.id}
                                task={task}
                              />
                            ))}
                          </div>
                        ) : (
                          <TaskButton
                            compact
                            onOpen={() => {
                              setSelectedWorktreeId(record.worktree.id);
                              setSelectedTaskId(latest.id);
                            }}
                            task={latest}
                          />
                        )}
                        <Button
                          className="mt-2 h-auto px-0 py-0 text-muted-foreground text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedWorktreeId(record.worktree.id);
                          }}
                          size="sm"
                          type="button"
                          variant="link"
                        >
                          {expanded
                            ? `${record.tasks.length} tasks shown`
                            : `View all ${record.tasks.length} tasks`}
                        </Button>
                      </div>
                    ) : (
                      <EmptyTasks
                        available={record.available}
                        showAction={showAction}
                        worktree={record.worktree}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {latest ? (
                      <div className="flex justify-end gap-2">
                        <TaskActions showAction={showAction} task={latest} />
                        <NewTaskButton
                          showAction={showAction}
                          worktree={record.worktree}
                        />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function VariantB({
  records,
  selectedTaskId,
  selectedWorktreeId,
  setSelectedTaskId,
  setSelectedWorktreeId,
  showAction,
}: PrototypeProps) {
  const selectedRecord =
    records.find((record) => record.worktree.id === selectedWorktreeId) ??
    records[0];
  const selectedTask =
    selectedRecord?.tasks.find((task) => task.id === selectedTaskId) ??
    selectedRecord?.tasks[0];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PrototypeHeading
        description="Use a compact worktree navigator on the left and give the selected worktree's Codex tasks the main content pane."
        label="Task rail"
      />
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <nav className="flex min-h-0 flex-col border-r bg-muted/20">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.14em]">
              Worktrees
            </span>
            <Badge variant="outline">{records.length}</Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="divide-y">
              {records.map((record) => {
                const selected =
                  record.worktree.id === selectedRecord?.worktree.id;
                const liveCount = record.tasks.filter(
                  (task) =>
                    task.activity === "working" || task.activity === "waiting"
                ).length;
                return (
                  <Button
                    className={`grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-start justify-stretch gap-2 whitespace-normal rounded-none border-l-2 px-3 py-3 text-left transition-colors ${
                      selected
                        ? "border-l-foreground bg-muted/70"
                        : "border-l-transparent hover:bg-muted/35"
                    }`}
                    key={record.worktree.id}
                    onClick={() => {
                      setSelectedWorktreeId(record.worktree.id);
                      if (record.tasks[0]) {
                        setSelectedTaskId(record.tasks[0].id);
                      }
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <WorktreeIdentity worktree={record.worktree} />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {liveCount > 0 ? (
                        <span
                          className="size-2 rounded-full bg-status-running-foreground"
                          title={`${liveCount} live tasks`}
                        />
                      ) : null}
                      <Badge variant="outline">
                        {record.available ? record.tasks.length : "—"}
                      </Badge>
                    </div>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
        </nav>
        {selectedRecord ? (
          <aside className="flex min-h-0 flex-col bg-background">
            <header className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.16em]">
                  <BotIcon className="size-3.5" />
                  Codex tasks
                </div>
                <h3 className="mt-1 truncate font-semibold text-lg">
                  {selectedRecord.worktree.name}
                </h3>
                <p className="mt-1 text-muted-foreground text-xs">
                  {selectedRecord.tasks.length} associated tasks · newest first
                </p>
              </div>
              <NewTaskButton
                showAction={showAction}
                worktree={selectedRecord.worktree}
              />
            </header>
            <ScrollArea className="min-h-0 flex-1">
              {selectedRecord.tasks.length > 0 ? (
                <div className="divide-y">
                  {selectedRecord.tasks.map((task) => (
                    <TaskButton
                      key={task.id}
                      onOpen={() => setSelectedTaskId(task.id)}
                      selected={task.id === selectedTask?.id}
                      task={task}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-4">
                  <EmptyTasks
                    available={selectedRecord.available}
                    showAction={showAction}
                    worktree={selectedRecord.worktree}
                  />
                </div>
              )}
            </ScrollArea>
            {selectedTask ? (
              <footer className="border-t bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm">
                      {selectedTask.title}
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      {selectedTask.contextShared
                        ? `Workgrove context shared ${selectedTask.contextShared}`
                        : "Workgrove context not shared"}
                    </div>
                  </div>
                  <TaskActions showAction={showAction} task={selectedTask} />
                </div>
              </footer>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function VariantC({
  records,
  selectedTaskId,
  setSelectedTaskId,
  showAction,
}: PrototypeProps) {
  const activeTasks = records.flatMap((record) =>
    record.tasks.filter(
      (task) => task.activity === "working" || task.activity === "waiting"
    )
  );
  return (
    <ScrollArea className="h-full" scrollbars={["vertical"]}>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 pb-20">
        <div className="grid items-end gap-4 lg:grid-cols-[1fr_auto]">
          <PrototypeHeading
            description="Make task activity the organizing layer. Every task stays visible, while worktree and app-group context become section metadata."
            label="Activity ledger"
          />
          <div className="flex gap-2">
            <Badge variant="secondary">
              <RadioIcon />
              {activeTasks.length} live tasks
            </Badge>
            <Badge variant="outline">
              <ListTreeIcon />
              {records.reduce((sum, record) => sum + record.tasks.length, 0)}{" "}
              total
            </Badge>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {records.map((record) => (
            <Card className="overflow-hidden" key={record.worktree.id}>
              <CardHeader className="border-b bg-muted/25">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>
                      <WorktreeIdentity worktree={record.worktree} />
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {record.worktree.appGroups
                        .map((group) => group.name)
                        .join(" · ")}
                    </CardDescription>
                  </div>
                  <NewTaskButton
                    showAction={showAction}
                    worktree={record.worktree}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {record.tasks.length > 0 ? (
                  <div className="divide-y">
                    {record.tasks.map((task, index) => (
                      <div
                        className={`grid gap-3 p-4 transition-colors md:grid-cols-[2rem_minmax(0,1fr)_auto] ${
                          selectedTaskId === task.id
                            ? "bg-muted/55"
                            : "hover:bg-muted/25"
                        }`}
                        key={task.id}
                      >
                        <div className="flex flex-col items-center">
                          <span className="grid size-7 place-items-center rounded-full border bg-background font-mono text-[11px]">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {index < record.tasks.length - 1 ? (
                            <span className="mt-1 min-h-6 w-px flex-1 bg-border" />
                          ) : null}
                        </div>
                        <Button
                          className="h-auto min-w-0 flex-col items-start justify-start whitespace-normal p-0 text-left hover:bg-transparent"
                          onClick={() => setSelectedTaskId(task.id)}
                          type="button"
                          variant="ghost"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm">{task.title}</strong>
                            <ActivityBadge state={task.activity} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
                            <span>Updated {task.updated}</span>
                            <span>
                              {task.contextShared
                                ? `Context ${task.contextShared}`
                                : "No context shared"}
                            </span>
                            {task.subagentCount > 0 ? (
                              <span>{task.subagentCount} subagents active</span>
                            ) : null}
                          </div>
                        </Button>
                        <TaskActions showAction={showAction} task={task} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4">
                    <EmptyTasks
                      available={record.available}
                      showAction={showAction}
                      worktree={record.worktree}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function PrototypeHeading({
  description,
  label,
}: {
  description: string;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.16em]">
        <MessageSquareIcon className="size-3.5" />
        Codex prototype · {label}
      </div>
      <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
        {description}
      </p>
    </div>
  );
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: CodexPrototypeVariant;
  onChange: (variant: CodexPrototypeVariant) => void;
}) {
  const currentIndex = VARIANTS.findIndex((variant) => variant.key === current);
  function move(offset: number) {
    const index = (currentIndex + offset + VARIANTS.length) % VARIANTS.length;
    onChange(VARIANTS[index].key);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      if (event.key === "ArrowLeft") {
        move(-1);
      }
      if (event.key === "ArrowRight") {
        move(1);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const selected = VARIANTS[currentIndex];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1 text-background shadow-xl">
      <Button
        aria-label="Previous Codex prototype variant"
        onClick={() => move(-1)}
        size="icon-sm"
        variant="ghost"
      >
        <ArrowLeftIcon />
      </Button>
      <span className="min-w-44 px-3 text-center font-medium text-xs">
        {selected.key} — {selected.name}
      </span>
      <Button
        aria-label="Next Codex prototype variant"
        onClick={() => move(1)}
        size="icon-sm"
        variant="ghost"
      >
        <ArrowRightIcon />
      </Button>
    </div>
  );
}

export function codexPrototypeVariantFromSearch(
  search: string
): CodexPrototypeVariant | null {
  const value = new URLSearchParams(search).get("codexVariant");
  return value === "A" || value === "B" || value === "C" ? value : null;
}

export function CodexTasksPrototype({
  initialVariant,
  workspace,
}: {
  initialVariant: CodexPrototypeVariant;
  workspace: WorkspaceSnapshot;
}) {
  const records = prototypeRecords(workspace);
  const firstRecord = records[0];
  const [variant, setVariant] = useState(initialVariant);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(
    firstRecord?.worktree.id ?? null
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    firstRecord?.tasks[0]?.id ?? null
  );
  const [action, setAction] = useState<string | null>(null);
  function changeVariant(next: CodexPrototypeVariant) {
    const url = new URL(window.location.href);
    url.searchParams.set("codexVariant", next);
    window.history.replaceState(null, "", url);
    setVariant(next);
  }
  function showAction(message: string) {
    setAction(message);
  }
  const props: PrototypeProps = {
    records,
    selectedTaskId,
    selectedWorktreeId,
    setSelectedTaskId,
    setSelectedWorktreeId,
    showAction,
  };
  return (
    <>
      {variant === "A" ? <VariantA {...props} /> : null}
      {variant === "B" ? <VariantB {...props} /> : null}
      {variant === "C" ? <VariantC {...props} /> : null}
      {action ? (
        <Button
          className="fixed right-4 bottom-4 z-50 h-auto max-w-sm justify-start whitespace-normal rounded-lg border bg-background px-4 py-3 text-left text-sm shadow-lg"
          onClick={() => setAction(null)}
          type="button"
          variant="outline"
        >
          <span className="block font-medium">Prototype action</span>
          <span className="mt-0.5 block text-muted-foreground">{action}</span>
        </Button>
      ) : null}
      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </>
  );
}
