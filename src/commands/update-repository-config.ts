import type { WorkgroveConfig } from "../config/workgrove-schema";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function updateRepositoryConfig(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  controller.updateConfiguration(
    requiredString(input.repoPath, "Repository path"),
    input.config as WorkgroveConfig,
    requiredString(input.revision, "Configuration revision")
  );
  return {
    command: "update-repository-config",
    message: "Saved repository configuration",
    ok: true,
  };
}
