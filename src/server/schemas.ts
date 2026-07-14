import { z } from "zod";
import { WorkgroveCommandSchema } from "../config/workgrove-command";
import { WorkgroveConfigSchema } from "../config/workgrove-schema";

export const WorkspaceQuerySchema = z.object({ repoPath: z.string().min(1) });
export const LogsQuerySchema = WorkspaceQuerySchema.extend({
  worktreeId: z.string().min(1),
});

const AppEndpointSchema = z.object({
  id: z.string(),
  label: z.string(),
  listening: z.boolean(),
  open: z.boolean(),
  ownership: z.enum(["owned", "foreign", "none"]),
  port: z.number().int(),
  probe: z.enum(["tcp", "none"]),
  required: z.boolean(),
  url: z.string(),
});

export const WorkspaceSnapshotSchema = z.object({
  commandProfile: z.object({
    setup: WorkgroveCommandSchema.nullable(),
    start: WorkgroveCommandSchema.nullable(),
    startMode: z.enum(["aggregate", "none", "per-app"]),
  }),
  config: WorkgroveConfigSchema,
  configPath: z.string(),
  configRevision: z.string().min(1),
  globalProcesses: z.array(
    z.object({
      argv: z.array(z.string()),
      cwd: z.string(),
      label: z.string(),
      ownerId: z.string(),
      pid: z.number().int().positive(),
      startedAt: z.string(),
    })
  ),
  globalRunningCount: z.number().int().nonnegative(),
  defaultSlot: z.number().int().nonnegative(),
  mainWorktreePath: z.string(),
  repoName: z.string(),
  repoPath: z.string(),
  setupAvailable: z.boolean(),
  slotEnv: z.string(),
  slotFile: z.string(),
  slotOptions: z.array(
    z.object({
      apps: z.array(z.object({ label: z.string(), port: z.number().int() })),
      collisionOwners: z.array(z.object({ id: z.string(), name: z.string() })),
      slot: z.number().int().nonnegative(),
    })
  ),
  trustCommands: z.array(z.string()),
  trustRequired: z.boolean(),
  trusted: z.boolean(),
  updatedAt: z.string(),
  worktrees: z.array(
    z.object({
      appLabel: z.string(),
      apps: z.array(AppEndpointSchema),
      branch: z.string(),
      health: z.enum(["not-running", "partially-running", "running"]),
      id: z.string(),
      isMain: z.boolean(),
      name: z.string(),
      path: z.string(),
      processRunning: z.boolean(),
      setupState: z.enum(["failed", "idle", "running"]),
      slot: z.number().int().nonnegative().nullable(),
      slotState: z.enum(["assigned", "conflicting", "invalid", "unassigned"]),
    })
  ),
});

export const LogsResponseSchema = z.object({ lines: z.array(z.string()) });
export const SessionResponseSchema = z.object({ token: z.string().min(1) });
