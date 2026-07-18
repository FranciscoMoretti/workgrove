import { useCallback, useMemo } from "react";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import {
  appGroupIsStopped,
  appsAreStopped,
} from "../controller/workspace-snapshot";
import { useCommands } from "./mutations";
import type { RequestRepositoryTrust } from "./use-repository-trust";
import type { WorktreeCommandActions } from "./worktree-command-menu";

function requestedWorktreeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function useWorktreeCommandActions({
  repoPath,
  requestRepositoryTrust,
  worktrees,
}: {
  repoPath: string;
  requestRepositoryTrust: RequestRepositoryTrust;
  worktrees: WorktreeSnapshot[];
}) {
  const commands = useCommands(repoPath);
  const pendingIds = useMemo(
    () =>
      new Set(
        [
          commands.startApps.isPending
            ? commands.startApps.variables?.worktreeId
            : null,
          commands.stopApps.isPending
            ? commands.stopApps.variables?.worktreeId
            : null,
          commands.switchSlot.isPending
            ? commands.switchSlot.variables?.worktreeId
            : null,
          commands.restartApps.isPending
            ? commands.restartApps.variables?.worktreeId
            : null,
          commands.setSlot.isPending
            ? commands.setSlot.variables?.worktreeId
            : null,
          commands.deleteWorktree.isPending
            ? commands.deleteWorktree.variables?.worktreeId
            : null,
          ...(commands.setupAllApps.isPending
            ? requestedWorktreeIds(commands.setupAllApps.variables?.worktreeIds)
            : []),
        ].filter((id): id is string => typeof id === "string")
      ),
    [
      commands.deleteWorktree.isPending,
      commands.deleteWorktree.variables,
      commands.restartApps.isPending,
      commands.restartApps.variables,
      commands.setSlot.isPending,
      commands.setSlot.variables,
      commands.setupAllApps.isPending,
      commands.setupAllApps.variables,
      commands.startApps.isPending,
      commands.startApps.variables,
      commands.stopApps.isPending,
      commands.stopApps.variables,
      commands.switchSlot.isPending,
      commands.switchSlot.variables,
    ]
  );

  const startApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = worktree.appGroups[0]?.name;
      if (!appGroupName) {
        return;
      }
      requestRepositoryTrust("Start apps", () => {
        commands.startApps.mutate({
          appGroupName,
          repoPath,
          worktreeId: worktree.id,
        });
      });
    },
    [commands.startApps, repoPath, requestRepositoryTrust]
  );

  const stopApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = worktree.appGroups[0]?.name;
      if (appGroupName) {
        commands.stopApps.mutate({
          appGroupName,
          repoPath,
          worktreeId: worktree.id,
        });
      }
    },
    [commands.stopApps, repoPath]
  );

  const restartApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = worktree.appGroups[0]?.name;
      if (!appGroupName) {
        return;
      }
      requestRepositoryTrust("Restart apps", () => {
        commands.restartApps.mutate({
          appGroupName,
          repoPath,
          worktreeId: worktree.id,
        });
      });
    },
    [commands.restartApps, repoPath, requestRepositoryTrust]
  );

  const setupApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      requestRepositoryTrust("Run setup", () => {
        commands.setupAllApps.mutate({
          repoPath,
          worktreeIds: [worktree.id],
        });
      });
    },
    [commands.setupAllApps, repoPath, requestRepositoryTrust]
  );

  const commandActions = useMemo<WorktreeCommandActions>(
    () => ({
      onRestart: restartApps,
      onSetup: setupApps,
      onStart: startApps,
      onStop: stopApps,
    }),
    [restartApps, setupApps, startApps, stopApps]
  );

  const toggleApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      if (appsAreStopped(worktree)) {
        startApps(worktree);
        return;
      }
      stopApps(worktree);
    },
    [startApps, stopApps]
  );

  const toggleAppGroup = useCallback(
    (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => {
      if (appGroupIsStopped(group)) {
        requestRepositoryTrust(`Start ${group.name}`, () => {
          commands.startApps.mutate({
            appGroupName: group.name,
            repoPath,
            worktreeId: worktree.id,
          });
        });
      } else {
        commands.stopApps.mutate({
          appGroupName: group.name,
          repoPath,
          worktreeId: worktree.id,
        });
      }
    },
    [commands.startApps, commands.stopApps, repoPath, requestRepositoryTrust]
  );

  const visibleActions = useMemo(() => {
    const worktreeIds = worktrees.map((worktree) => worktree.id);
    const pending =
      commands.restartRunningApps.isPending ||
      commands.setupAllApps.isPending ||
      commands.startAllApps.isPending ||
      commands.stopAllApps.isPending;
    return {
      onRestart: () =>
        requestRepositoryTrust("Restart running apps", () =>
          commands.restartRunningApps.mutate({ repoPath, worktreeIds })
        ),
      onSetup: () =>
        requestRepositoryTrust("Run setup", () =>
          commands.setupAllApps.mutate({ repoPath, worktreeIds })
        ),
      onStart: () =>
        requestRepositoryTrust("Start all apps", () =>
          commands.startAllApps.mutate({ repoPath, worktreeIds })
        ),
      onStop: () => commands.stopAllApps.mutate({ repoPath, worktreeIds }),
      pending,
    };
  }, [
    commands.restartRunningApps,
    commands.setupAllApps,
    commands.startAllApps,
    commands.stopAllApps,
    repoPath,
    requestRepositoryTrust,
    worktrees,
  ]);

  return {
    commandActions,
    commands,
    pendingIds,
    restartApps,
    toggleAppGroup,
    toggleApps,
    visibleActions,
  };
}
