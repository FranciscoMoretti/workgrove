import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import type {
  CommandReceipt,
  SlotOption,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { Modal } from "./modal";
import { Button } from "./ui/button";

export function SlotDialog({
  mutation,
  onClose,
  open,
  option,
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
  option: SlotOption | null;
  repoPath: string;
  worktree: WorktreeSnapshot | null;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!(worktree && option)) {
    return null;
  }
  const selectedOption = option;
  const target = worktree;
  async function confirm() {
    try {
      setError(null);
      await mutation.mutateAsync({
        repoPath,
        slot: selectedOption.slot,
        worktreeId: target.id,
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not change slot"
      );
    }
  }
  return (
    <Modal onClose={onClose} open={open} title="Change app slot">
      <div className="modal-copy">
        <p>
          Assign <strong>{worktree.name}</strong> to slot{" "}
          <strong>{option.slot}</strong>?
        </p>
        <div className="port-preview">
          {option.apps.map((app) => (
            <span key={`${app.label}:${app.port}`}>
              <b>{app.label}</b>
              <code>{app.port}</code>
            </span>
          ))}
        </div>
        <p className="hint">
          This updates only the configured slot variable in the worktree-local
          environment file.
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
        <Button disabled={mutation.isPending} onClick={confirm}>
          {mutation.isPending ? "Assigning…" : `Assign slot ${option.slot}`}
        </Button>
      </div>
    </Modal>
  );
}
