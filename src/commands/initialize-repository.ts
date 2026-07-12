import { initializeRepository as initialize } from "../controller/repository-initializer";
import type { WorkspaceController } from "../controller/workspace-controller";
import { requiredString } from "./command";

export function initializeRepository(
  _controller: WorkspaceController,
  input: Record<string, unknown>
) {
  return initialize(requiredString(input.repoPath, "Repository path"));
}
