import { z } from "zod";

import { WorkgroveConfigSchema } from "../config/workgrove-schema";
import type { CommandReceiptSchema } from "./command-contract";

const AppHealthSchema = z.enum(["not-running", "partially-running", "running"]);

export const AppEndpointSnapshotSchema = z.strictObject({
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

export const AppGroupSnapshotSchema = z.strictObject({
  apps: z.array(AppEndpointSnapshotSchema),
  health: AppHealthSchema,
  id: z.string().min(1),
  instance: z.strictObject({
    id: z.string().min(1),
    mode: z.enum(["per-worktree", "selectable"]),
    name: z.string().min(1),
  }),
  instances: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      running: z.boolean(),
    })
  ),
  name: z.string().min(1),
  processRunning: z.boolean(),
  stop: z.enum(["command", "process"]),
});

export const WorktreeSnapshotSchema = z.strictObject({
  appGroups: z.array(AppGroupSnapshotSchema),
  appLabel: z.string(),
  apps: z.array(AppEndpointSnapshotSchema),
  branch: z.string(),
  health: AppHealthSchema,
  id: z.string(),
  isMain: z.boolean(),
  name: z.string(),
  path: z.string(),
  processRunning: z.boolean(),
  setupState: z.enum(["failed", "idle", "running"]),
});

export const WorkspaceSnapshotSchema = z.strictObject({
  config: WorkgroveConfigSchema,
  configPath: z.string(),
  configRevision: z.string().min(1),
  globalProcesses: z.array(
    z.strictObject({
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
  worktrees: z.array(WorktreeSnapshotSchema),
});

export type AppHealth = z.infer<typeof AppHealthSchema>;
export type AppEndpointSnapshot = z.infer<typeof AppEndpointSnapshotSchema>;
export type AppGroupSnapshot = z.infer<typeof AppGroupSnapshotSchema>;
export type GlobalProcessSnapshot = z.infer<
  typeof WorkspaceSnapshotSchema.shape.globalProcesses.element
>;
export type WorktreeSnapshot = z.infer<typeof WorktreeSnapshotSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export function appGroupIsRunning(
  group: Pick<AppGroupSnapshot, "health" | "processRunning">
): boolean {
  return group.health !== "not-running" || group.processRunning;
}

export function appGroupIsStopped(
  group: Pick<AppGroupSnapshot, "health" | "processRunning">
): boolean {
  return !appGroupIsRunning(group);
}

export function appGroupCanRestart(
  group: Pick<AppGroupSnapshot, "health" | "processRunning">
): boolean {
  return appGroupIsRunning(group);
}

export function worktreeHasRunningAppGroups(
  worktree: Pick<WorktreeSnapshot, "appGroups">
): boolean {
  return worktree.appGroups.some(
    (group) =>
      appGroupIsRunning(group) ||
      group.instances.some((instance) => instance.running)
  );
}

export function appsAreRunning(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning">
): boolean {
  return worktree.health !== "not-running" || worktree.processRunning;
}

export function appsAreStopped(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning">
): boolean {
  return !appsAreRunning(worktree);
}

export function appsCanRestart(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning">
): boolean {
  return appsAreRunning(worktree);
}
