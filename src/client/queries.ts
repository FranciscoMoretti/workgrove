import { useQuery } from "@tanstack/react-query";

import { fetchLogs, fetchWorkspace } from "./api";

export const REFRESH_INTERVAL = 30_000;

export function useWorkspace(repoPath: string) {
  return useQuery({
    enabled: repoPath !== "",
    queryFn: () => fetchWorkspace(repoPath),
    queryKey: ["workspace", repoPath],
    refetchInterval: (query) =>
      query.state.status === "error" ? false : REFRESH_INTERVAL,
    retry: false,
    staleTime: REFRESH_INTERVAL,
  });
}

export function useLogs(repoPath: string, worktreeId: string | null) {
  return useQuery({
    enabled: repoPath !== "" && worktreeId !== null,
    queryFn: () => {
      if (!worktreeId) {
        throw new Error("No selected worktree");
      }
      return fetchLogs(repoPath, worktreeId);
    },
    queryKey: ["logs", repoPath, worktreeId],
    refetchInterval: 2500,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: 500,
  });
}
