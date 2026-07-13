import { useCallback, useMemo } from "react";

import type { WorktreeSnapshot } from "../controller/workspace-snapshot";
import { appsAreStopped } from "../controller/workspace-snapshot";
import { useCommands } from "./mutations";
import type { RequestRepositoryTrust } from "./use-repository-trust";
import type { WorktreeCommandActions } from "./worktree-command-menu";

function requestedWorktreeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function useWorktreeCommandActions({
  onSelectWorktree,
  repoPath,
  requestRepositoryTrust,
  setupAvailable,
  worktrees,
}: {
  onSelectWorktree: (worktreeId: string) => void;
  repoPath: string;
  requestRepositoryTrust: RequestRepositoryTrust;
  setupAvailable: boolean;
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
    ]
  );

  const startApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      requestRepositoryTrust("Start apps", () => {
        commands.startApps.mutate({ repoPath, worktreeId: worktree.id });
        onSelectWorktree(worktree.id);
      });
    },
    [commands.startApps, onSelectWorktree, repoPath, requestRepositoryTrust]
  );

  const stopApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      commands.stopApps.mutate({ repoPath, worktreeId: worktree.id });
      onSelectWorktree(worktree.id);
    },
    [commands.stopApps, onSelectWorktree, repoPath]
  );

  const restartApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      requestRepositoryTrust("Restart apps", () => {
        commands.restartApps.mutate({ repoPath, worktreeId: worktree.id });
        onSelectWorktree(worktree.id);
      });
    },
    [commands.restartApps, onSelectWorktree, repoPath, requestRepositoryTrust]
  );

  const setupApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      requestRepositoryTrust("Run setup", () => {
        commands.setupAllApps.mutate({
          repoPath,
          worktreeIds: [worktree.id],
        });
        onSelectWorktree(worktree.id);
      });
    },
    [commands.setupAllApps, onSelectWorktree, repoPath, requestRepositoryTrust]
  );

  const commandActions = useMemo<WorktreeCommandActions>(
    () => ({
      onRestart: restartApps,
      onSetup: setupApps,
      onStart: startApps,
      onStop: stopApps,
      setupAvailable,
    }),
    [restartApps, setupApps, setupAvailable, startApps, stopApps]
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
      setupAvailable,
    };
  }, [
    commands.restartRunningApps,
    commands.setupAllApps,
    commands.startAllApps,
    commands.stopAllApps,
    repoPath,
    requestRepositoryTrust,
    setupAvailable,
    worktrees,
  ]);

  return {
    commandActions,
    commands,
    pendingIds,
    restartApps,
    toggleApps,
    visibleActions,
  };
}
