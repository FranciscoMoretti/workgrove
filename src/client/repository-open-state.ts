import { WorkgroveApiError } from "./api";

export function missingConfigPath(error: unknown): string | null {
  return error instanceof WorkgroveApiError &&
    error.code === "missing_worktree_config"
    ? error.configPath
    : null;
}
