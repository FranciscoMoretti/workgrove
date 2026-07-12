import type { AppHealth, ControlledApp } from "../runtime/app-health";

export type AppEndpointSnapshot = ControlledApp & {
  listening: boolean;
  ownership: "owned" | "foreign" | "none";
};

export interface SlotOption {
  apps: Array<{ label: string; port: number }>;
  occupiedBy: string | null;
  slot: number;
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
  slot: number | null;
  slotState: "assigned" | "conflicting" | "invalid" | "unassigned";
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
  configPath: string;
  defaultSlot: number;
  globalProcesses: GlobalProcessSnapshot[];
  globalRunningCount: number;
  mainWorktreePath: string;
  repoName: string;
  repoPath: string;
  setupAvailable: boolean;
  slotEnv: string;
  slotFile: string;
  slotOptions: SlotOption[];
  trustCommands: string[];
  trusted: boolean;
  trustFingerprint: string;
  trustRequired: boolean;
  updatedAt: string;
  worktrees: WorktreeSnapshot[];
}

export interface CommandReceipt {
  command: string;
  message: string;
  ok: true;
  worktreeId?: string;
}
