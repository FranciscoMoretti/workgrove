import type { WorkgroveConfig } from "../config/workgrove-schema";
import type { LocalRouteState } from "../runtime/local-routing";

export type AppHealth = "not-running" | "partially-running" | "running";

export interface AppEndpointSnapshot {
  directUrl: string | null;
  id: string;
  label: string;
  listening: boolean;
  open: boolean;
  ownership: "foreign" | "none" | "owned";
  port: number | null;
  protocol: "http" | "tcp";
  readiness: "ready" | "unready" | "waiting";
  routeState: LocalRouteState;
  url: string | null;
}

export interface AppGroupSnapshot {
  apps: AppEndpointSnapshot[];
  health: AppHealth;
  id: string;
  instance: {
    id: string;
    mode: "per-worktree" | "selectable";
    name: string;
  };
  instances: Array<{
    id: string;
    name: string;
    running: boolean;
  }>;
  name: string;
  processRunning: boolean;
  stop: "command" | "process";
}

export interface GlobalProcessSnapshot {
  argv: string[];
  cwd: string;
  label: string;
  ownerId: string;
  pid: number;
  startedAt: string;
}

export interface WorktreeSnapshot {
  appGroups: AppGroupSnapshot[];
  appLabel: string;
  apps: AppEndpointSnapshot[];
  branch: string;
  health: AppHealth;
  id: string;
  isMain: boolean;
  name: string;
  path: string;
  processRunning: boolean;
  setupState: "failed" | "idle" | "running";
}

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

export interface WorkspaceSnapshot {
  config: WorkgroveConfig;
  configPath: string;
  configRevision: string;
  globalProcesses: GlobalProcessSnapshot[];
  globalRunningCount: number;
  mainWorktreePath: string;
  primaryAppGroup: string;
  repoName: string;
  repoPath: string;
  trustCommands: string[];
  trusted: boolean;
  trustRequired: boolean;
  updatedAt: string;
  worktrees: WorktreeSnapshot[];
}

export interface CommandReceipt {
  appGroupName?: string;
  command: string;
  message: string;
  ok: true;
  worktreeId?: string;
}
