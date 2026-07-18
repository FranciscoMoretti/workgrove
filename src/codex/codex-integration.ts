import { z } from "zod";

const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const CodexTaskActivitySnapshotSchema = z.object({
  observedAt: IsoTimestampSchema,
  state: z.enum(["working", "waiting-for-approval", "ready", "unknown"]),
  subagentCount: z.number().int().nonnegative(),
});

export const CodexTaskSnapshotSchema = z.object({
  activity: CodexTaskActivitySnapshotSchema.nullable(),
  contextSharedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
  id: z.string().min(1).max(512),
  title: z.string().min(1).max(1024),
  updatedAt: IsoTimestampSchema,
});

export const CodexIntegrationSnapshotSchema = z.object({
  updatedAt: IsoTimestampSchema,
  worktrees: z.record(
    z.string().min(1),
    z.object({ tasks: z.array(CodexTaskSnapshotSchema) })
  ),
});

export type CodexTaskActivitySnapshot = z.infer<
  typeof CodexTaskActivitySnapshotSchema
>;
export type CodexTaskActivityState = CodexTaskActivitySnapshot["state"];
export type CodexTaskSnapshot = z.infer<typeof CodexTaskSnapshotSchema>;
export type CodexIntegrationSnapshot = z.infer<
  typeof CodexIntegrationSnapshotSchema
>;

export interface CodexWorktreeReference {
  id: string;
  path: string;
}

export interface AssociatedCodexTask {
  task: CodexTaskSnapshot;
  worktreePath: string;
}

export interface CodexIntegrationAdapterSnapshot {
  tasks: readonly AssociatedCodexTask[];
  updatedAt: string;
}

export interface CodexIntegrationAdapter {
  loadAssociatedTasks(
    worktrees: readonly CodexWorktreeReference[]
  ): Promise<CodexIntegrationAdapterSnapshot>;
}

export class CodexIntegrationUnavailableError extends Error {
  readonly code = "codex_integration_unavailable";

  constructor(message = "Codex task discovery is unavailable") {
    super(message);
    this.name = "CodexIntegrationUnavailableError";
  }
}

export class FakeCodexIntegrationAdapter implements CodexIntegrationAdapter {
  readonly requests: CodexWorktreeReference[][] = [];
  private readonly snapshot: CodexIntegrationAdapterSnapshot;

  constructor(snapshot: CodexIntegrationAdapterSnapshot) {
    this.snapshot = snapshot;
  }

  loadAssociatedTasks(
    worktrees: readonly CodexWorktreeReference[]
  ): Promise<CodexIntegrationAdapterSnapshot> {
    this.requests.push(worktrees.map((worktree) => ({ ...worktree })));
    return Promise.resolve(this.snapshot);
  }
}

export class UnavailableCodexIntegrationAdapter
  implements CodexIntegrationAdapter
{
  loadAssociatedTasks(
    _worktrees: readonly CodexWorktreeReference[]
  ): Promise<CodexIntegrationAdapterSnapshot> {
    return Promise.reject(new CodexIntegrationUnavailableError());
  }
}

export function orderCodexTasks(
  tasks: readonly CodexTaskSnapshot[]
): CodexTaskSnapshot[] {
  return tasks
    .map((task) => CodexTaskSnapshotSchema.parse(task))
    .sort((left, right) => {
      const recency = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return recency === 0 ? left.id.localeCompare(right.id) : recency;
    });
}

export function projectCodexIntegration(
  worktrees: readonly CodexWorktreeReference[],
  adapterSnapshot: CodexIntegrationAdapterSnapshot
): CodexIntegrationSnapshot {
  const tasksByPath = new Map<string, CodexTaskSnapshot[]>();
  for (const { task, worktreePath } of adapterSnapshot.tasks) {
    const tasks = tasksByPath.get(worktreePath) ?? [];
    tasks.push(task);
    tasksByPath.set(worktreePath, tasks);
  }

  return {
    updatedAt: adapterSnapshot.updatedAt,
    worktrees: Object.fromEntries(
      worktrees.map(({ id, path }) => [
        id,
        { tasks: orderCodexTasks(tasksByPath.get(path) ?? []) },
      ])
    ),
  };
}
