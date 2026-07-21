import { z } from "zod";
import { WorkgroveConfigSchema } from "../config/workgrove-schema";

export const WorkspaceQuerySchema = z.object({ repoPath: z.string().min(1) });
export const LogsQuerySchema = WorkspaceQuerySchema.extend({
  appGroupName: z.string().min(1),
  worktreeId: z.string().min(1),
});

const AppEndpointSchema = z.object({
  directUrl: z.string().nullable(),
  id: z.string(),
  label: z.string(),
  listening: z.boolean(),
  open: z.boolean(),
  ownership: z.enum(["owned", "foreign", "none"]),
  port: z.number().int().nullable(),
  protocol: z.enum(["http", "tcp"]),
  readiness: z.enum(["ready", "unready", "waiting"]),
  routeState: z.enum(["inactive", "active", "conflict", "unavailable"]),
  url: z.string().nullable(),
});

const AppGroupSchema = z.object({
  apps: z.array(AppEndpointSchema),
  health: z.enum(["not-running", "partially-running", "running"]),
  id: z.string().min(1),
  name: z.string().min(1),
  processRunning: z.boolean(),
  stop: z.enum(["command", "process"]),
});

export const WorkspaceSnapshotSchema = z.object({
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
  mainWorktreePath: z.string(),
  primaryAppGroup: z.string().min(1),
  repoName: z.string(),
  repoPath: z.string(),
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
    })
  ),
});

export const LogsResponseSchema = z.object({ lines: z.array(z.string()) });
export const SessionResponseSchema = z.object({ token: z.string().min(1) });
