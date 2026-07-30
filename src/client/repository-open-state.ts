import { BranchBaseApiError } from "./api";

export function missingConfigPath(error: unknown): string | null {
  return error instanceof BranchBaseApiError &&
    error.code === "missing_worktree_config"
    ? error.configPath
    : null;
}
