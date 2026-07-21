import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function trustRepository(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  controller.trustRepository(repoPath);
  return {
    command: "trust-repository",
    message: "Trusted repository commands",
    ok: true,
  };
}
