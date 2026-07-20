import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runCommand } from "./api";

type CommandInput = Record<string, unknown> & {
  repoPath: string;
  worktreeId?: string;
};

function useCommand(command: string, repoPath: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CommandInput) => runCommand(command, input),
    mutationKey: ["command", command],
    onSuccess: async (_result, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["workspace", repoPath] }),
        input.worktreeId
          ? client.invalidateQueries({
              queryKey: ["logs", repoPath, input.worktreeId],
            })
          : Promise.resolve(),
      ]);
    },
  });
}

export function useCommands(repoPath: string) {
  const clearLogs = useCommand("clear-logs", repoPath);
  const createAppGroupInstance = useCommand(
    "create-app-group-instance",
    repoPath
  );
  const setupAllApps = useCommand("setup-all-apps", repoPath);
  const startApps = useCommand("start-apps", repoPath);
  const startAllApps = useCommand("start-all-apps", repoPath);
  const restartApps = useCommand("restart-apps", repoPath);
  const retryApps = useCommand("retry-apps", repoPath);
  const restartRunningApps = useCommand("restart-running-apps", repoPath);
  const selectAppGroupInstance = useCommand(
    "select-app-group-instance",
    repoPath
  );
  const stopApps = useCommand("stop-apps", repoPath);
  const stopAllApps = useCommand("stop-all-apps", repoPath);
  const trustRepository = useCommand("trust-repository", repoPath);
  const updateRepositoryConfig = useCommand(
    "update-repository-config",
    repoPath
  );
  const createWorktree = useCommand("create-worktree", repoPath);
  const deleteWorktree = useCommand("delete-worktree", repoPath);
  const mutations = {
    clearLogs,
    createAppGroupInstance,
    createWorktree,
    deleteWorktree,
    restartApps,
    retryApps,
    restartRunningApps,
    selectAppGroupInstance,
    setupAllApps,
    startAllApps,
    startApps,
    stopAllApps,
    stopApps,
    trustRepository,
    updateRepositoryConfig,
  };
  const errors = Object.values(mutations)
    .map((mutation) => mutation.error)
    .filter(Boolean);
  return { ...mutations, error: errors.at(-1) ?? null };
}
