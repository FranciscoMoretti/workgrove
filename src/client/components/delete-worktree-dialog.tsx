import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import type {
  CommandReceipt,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

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
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || mutation.isPending)) {
          onClose();
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worktree?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove this linked Git worktree from the repository.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <code className="path-callout">{worktree.path}</code>
        <p className="hint text-xs/relaxed">
          Git will refuse if the worktree has uncommitted changes. Workgrove
          never forces removal.
        </p>
        {error ? <p className="field-error">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={confirm}
            variant="destructive"
          >
            {mutation.isPending ? "Deleting…" : "Delete worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
