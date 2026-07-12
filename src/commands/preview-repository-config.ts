import { planRepositoryInitialization } from "../controller/repository-initializer";
import type { WorkspaceController } from "../controller/workspace-controller";
import { requiredString } from "./command";

export function previewRepositoryConfig(
  _controller: WorkspaceController,
  input: Record<string, unknown>
) {
  return planRepositoryInitialization(
    requiredString(input.repoPath, "Repository path")
  );
}
