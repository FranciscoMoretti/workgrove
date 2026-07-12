import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import type {
  CommandReceipt,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { Modal } from "./modal";
import { Button } from "./ui/button";

export function DeleteWorktreeDialog({
  mutation,
  onClose,
  open,
  repoPath,
  worktree,
}: {
  mutation: UseMutationResult<
    CommandReceipt,
    Error,
    Record<string, unknown> & { repoPath: string; worktreeId?: string }
  >;
  onClose: () => void;
  open: boolean;
  repoPath: string;
  worktree: WorktreeSnapshot | null;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!worktree) {
    return null;
  }
  const target = worktree;
  async function confirm() {
    try {
      setError(null);
      await mutation.mutateAsync({ repoPath, worktreeId: target.id });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete worktree"
      );
    }
  }
  return (
    <Modal onClose={onClose} open={open} title="Delete worktree">
      <div className="modal-copy">
        <p>Remove this Git worktree?</p>
        <code className="path-callout">{worktree.path}</code>
        <p className="hint">
          Git will refuse if the worktree has uncommitted changes. Workgrove
          never forces removal.
        </p>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="modal-actions">
        <Button
          disabled={mutation.isPending}
          onClick={onClose}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={mutation.isPending}
          onClick={confirm}
          variant="destructive"
        >
          {mutation.isPending ? "Deleting…" : "Delete worktree"}
        </Button>
      </div>
    </Modal>
  );
}
