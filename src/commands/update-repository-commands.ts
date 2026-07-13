import { updateRepositoryCommandProfile } from "../config/workgrove-config";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function updateRepositoryCommands(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const workspace = controller.inspect(repoPath);
  updateRepositoryCommandProfile(workspace.configPath, {
    setup: input.setup as Parameters<
      typeof updateRepositoryCommandProfile
    >[1]["setup"],
    ...(input.start === undefined
      ? {}
      : {
          start: input.start as Parameters<
            typeof updateRepositoryCommandProfile
          >[1]["start"],
        }),
  });
  return {
    command: "update-repository-commands",
    message: "Saved repository commands",
    ok: true,
  };
}
