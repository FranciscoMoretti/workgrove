import type { WorkspaceController } from "../controller/workspace-controller";
import { requiredString } from "./command";

export function initializeRepository(
  controller: WorkspaceController,
  input: Record<string, unknown>
) {
  return controller.initializeRepository(
    requiredString(input.repoPath, "Repository path")
  );
}
