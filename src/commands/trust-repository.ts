import {
  repositoryFingerprint,
  trustRepositoryConfig,
} from "../config/repository-trust";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function trustRepository(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const workspace = controller.inspect(repoPath);
  const config = controller.config(repoPath);
  const expected = requiredString(
    input.fingerprint,
    "Configuration fingerprint"
  );
  if (repositoryFingerprint(config) !== expected) {
    throw new Error("Repository commands changed; review them again");
  }
  trustRepositoryConfig(workspace.repoPath, config);
  return {
    command: "trust-repository",
    message: "Trusted repository commands",
    ok: true,
  };
}
