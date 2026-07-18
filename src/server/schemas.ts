import { z } from "zod";
import { WorkgroveConfigSchema } from "../config/workgrove-schema";

export const WorkspaceQuerySchema = z.object({ repoPath: z.string().min(1) });
export const LogsQuerySchema = WorkspaceQuerySchema.extend({
  appGroupName: z.string().min(1),
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

const AppGroupSchema = z.object({
  apps: z.array(AppEndpointSchema),
  health: z.enum(["not-running", "partially-running", "running"]),
  name: z.string().min(1),
  processRunning: z.boolean(),
  slot: z.number().int().nonnegative(),
  slotState: z.enum(["assigned", "conflicting", "invalid"]),
  stop: z.enum(["command", "process"]),
});

const SlotOptionSchema = z.object({
  apps: z.array(z.object({ label: z.string(), port: z.number().int() })),
  collisionOwners: z.array(z.object({ id: z.string(), name: z.string() })),
  slot: z.number().int().nonnegative(),
});

export const WorkspaceSnapshotSchema = z.object({
  appGroupSlotOptions: z.record(z.string(), z.array(SlotOptionSchema)),
  config: WorkgroveConfigSchema,
  configPath: z.string(),
  configRevision: z.string().min(1),
  defaultSlot: z.number().int().nonnegative(),
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
  mainWorktreePath: z.string(),
  primaryAppGroup: z.string().min(1),
  repoName: z.string(),
  repoPath: z.string(),
  slotFile: z.string(),
  slotOptions: z.array(SlotOptionSchema),
  trustCommands: z.array(z.string()),
  trustRequired: z.boolean(),
  trusted: z.boolean(),
  updatedAt: z.string(),
  worktrees: z.array(
    z.object({
      appGroups: z.array(AppGroupSchema),
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
      slot: z.number().int().nonnegative(),
      slotState: z.enum(["assigned", "conflicting", "invalid"]),
    })
  ),
});

export const LogsResponseSchema = z.object({ lines: z.array(z.string()) });
export const SessionResponseSchema = z.object({ token: z.string().min(1) });
