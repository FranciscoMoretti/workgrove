import { useQuery } from "@tanstack/react-query";

import { fetchCodexIntegration, fetchLogs, fetchWorkspace } from "./api";

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

export function useCodexIntegration(repoPath: string) {
  return useQuery({
    enabled: repoPath !== "",
    queryFn: () => fetchCodexIntegration(repoPath),
    queryKey: ["codex-integration", repoPath],
    refetchInterval: (query) =>
      query.state.status === "error" ? false : REFRESH_INTERVAL,
    retry: false,
    staleTime: REFRESH_INTERVAL,
  });
}

export function useLogs(
  repoPath: string,
  worktreeId: string | null,
  appGroupName: string | null
) {
  return useQuery({
    enabled: repoPath !== "" && worktreeId !== null && appGroupName !== null,
    queryFn: () => {
      if (!(worktreeId && appGroupName)) {
        throw new Error("No selected App group");
      }
      return fetchLogs(repoPath, worktreeId, appGroupName);
    },
    queryKey: ["logs", repoPath, worktreeId, appGroupName],
    refetchInterval: 2500,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: 500,
  });
}
