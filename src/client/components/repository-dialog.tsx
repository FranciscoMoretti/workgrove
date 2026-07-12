import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { useRepositoryOpen } from "../use-repository-open";
import { useRepositoryPicker } from "../use-repository-picker";
import { useRepositorySetup } from "../use-repository-setup";
import { Modal } from "./modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function RepositoryDialog({
  currentPath,
  onClose,
  onConfirm,
  open,
}: {
  currentPath: string;
  onClose: () => void;
  onConfirm: (path: string, snapshot: WorkspaceSnapshot) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState(currentPath);
  const opener = useRepositoryOpen((path, snapshot) => {
    onConfirm(path, snapshot);
    onClose();
  });
  function changeDraft(path: string) {
    opener.clearError();
    picker.clearError();
    setDraft(path);
  }
  const picker = useRepositoryPicker(changeDraft);
  const setup = useRepositorySetup({
    error: opener.error,
    onCreated: () => opener.open(draft.trim()),
    repoPath: draft.trim(),
  });

  async function confirm() {
    const path = draft.trim();
    if (!path) {
      return;
    }
    await opener.open(path);
  }
  function feedback() {
    if (setup.active) {
      return setup.notice();
    }
    const message = opener.error?.message ?? picker.error;
    return message ? <p className="field-error">{message}</p> : null;
  }

  return (
    <>
      <Modal onClose={onClose} open={open} title="Change repository">
        <div className="modal-copy fields">
          <p>
            The current repository stays open until the replacement has been
            verified.
          </p>
          <div className="repo-field">
            <label htmlFor="change-repository-path">Repository path</label>
            <div className="repository-path-control">
              <Input
                disabled={opener.pending || picker.pending}
                id="change-repository-path"
                onChange={(event) => changeDraft(event.target.value)}
                value={draft}
              />
              <Button
                aria-label="Choose repository folder"
                className="browse-button"
                disabled={opener.pending || picker.pending}
                onClick={picker.browse}
                variant="secondary"
              >
                <FolderOpenIcon />
                Browse
              </Button>
            </div>
          </div>
          {feedback()}
        </div>
        <div className="modal-actions">
          <Button
            disabled={opener.pending}
            onClick={onClose}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            disabled={
              opener.pending ||
              picker.pending ||
              draft.trim() === "" ||
              draft === currentPath
            }
            onClick={confirm}
          >
            {opener.pending ? "Checking…" : "Open repository"}
          </Button>
        </div>
      </Modal>
      {setup.dialog}
    </>
  );
}
