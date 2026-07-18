import type { WorkgroveConfig } from "../config/workgrove-schema";
import type { AppHealth, ControlledApp } from "../runtime/app-health";

export type AppEndpointSnapshot = ControlledApp & {
  listening: boolean;
  ownership: "owned" | "foreign" | "none";
};

export interface AppGroupSlotOption {
  apps: Array<{ label: string; port: number }>;
  collisionOwners: Array<{ id: string; name: string }>;
  slot: number;
}

export type SlotOption = AppGroupSlotOption;

export interface AppGroupSnapshot {
  apps: AppEndpointSnapshot[];
  health: AppHealth;
  name: string;
  processRunning: boolean;
  slot: number;
  slotState: "assigned" | "conflicting" | "invalid";
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
  slot: number;
  slotState: "assigned" | "conflicting" | "invalid";
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
  group: Pick<AppGroupSnapshot, "health" | "processRunning" | "slotState">
): boolean {
  return appGroupIsRunning(group) && group.slotState === "assigned";
}

export function worktreeHasRunningAppGroups(
  worktree: Pick<WorktreeSnapshot, "appGroups">
): boolean {
  return worktree.appGroups.some(appGroupIsRunning);
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
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning" | "slotState">
): boolean {
  return appsAreRunning(worktree) && worktree.slotState === "assigned";
}

export interface WorkspaceSnapshot {
  appGroupSlotOptions: Record<string, AppGroupSlotOption[]>;
  config: WorkgroveConfig;
  configPath: string;
  configRevision: string;
  defaultSlot: number;
  globalProcesses: GlobalProcessSnapshot[];
  globalRunningCount: number;
  mainWorktreePath: string;
  primaryAppGroup: string;
  repoName: string;
  repoPath: string;
  slotFile: string;
  slotOptions: AppGroupSlotOption[];
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
