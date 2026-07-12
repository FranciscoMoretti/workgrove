import type { UseMutationResult } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import type {
  CommandReceipt,
  SlotOption,
} from "../../controller/workspace-snapshot";
import { Modal } from "./modal";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function CreateWorktreeDialog({
  mutation,
  onClose,
  open,
  repoName,
  repoPath,
  slots,
}: {
  mutation: UseMutationResult<
    CommandReceipt,
    Error,
    Record<string, unknown> & { repoPath: string; worktreeId?: string }
  >;
  onClose: () => void;
  open: boolean;
  repoName: string;
  repoPath: string;
  slots: SlotOption[];
}) {
  const available = useMemo(
    () => slots.filter((slot) => slot.occupiedBy === null),
    [slots]
  );
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [slot, setSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBranch("");
      setCreateBranch(true);
      setError(null);
      setFolderName("");
      setSlot(available[0]?.slot ?? null);
    }
  }, [available, open]);
  const selected = available.find((option) => option.slot === slot) ?? null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (slot === null || branch.trim() === "") {
      setError("Branch and an available slot are required.");
      return;
    }
    try {
      setError(null);
      await mutation.mutateAsync({
        branch: branch.trim(),
        createBranch,
        folderName: folderName.trim() || undefined,
        repoPath,
        slot,
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create worktree"
      );
    }
  }
  return (
    <Modal onClose={onClose} open={open} title="New worktree">
      <form onSubmit={submit}>
        <div className="modal-copy fields">
          <p>
            Create a linked worktree, assign a free slot, then run the
            repository's configured setup command.
          </p>
          <label htmlFor="new-worktree-branch">
            <span>Branch</span>
            <Input
              autoFocus
              disabled={mutation.isPending}
              id="new-worktree-branch"
              onChange={(event) => setBranch(event.target.value)}
              placeholder="feature/my-branch"
              value={branch}
            />
          </label>
          <div className="checkbox">
            <Checkbox
              checked={createBranch}
              disabled={mutation.isPending}
              id="new-worktree-create-branch"
              onCheckedChange={(checked) => setCreateBranch(checked === true)}
            />
            <label htmlFor="new-worktree-create-branch">
              Create a new branch
            </label>
          </div>
          <label htmlFor="new-worktree-folder">
            <span>
              Folder name <small>optional</small>
            </span>
            <Input
              disabled={mutation.isPending}
              id="new-worktree-folder"
              onChange={(event) => setFolderName(event.target.value)}
              placeholder={
                slot === null ? `${repoName}-N` : `${repoName}-${slot}`
              }
              value={folderName}
            />
          </label>
          <label htmlFor="new-worktree-slot">
            <span>App slot</span>
            <Select
              disabled={mutation.isPending}
              onValueChange={(value) => setSlot(Number(value))}
              value={slot === null ? undefined : String(slot)}
            >
              <SelectTrigger
                className="form-select-trigger"
                id="new-worktree-slot"
              >
                <SelectValue placeholder="Choose an app slot">
                  {selected ? `App ${selected.slot}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="slot-select-content">
                {available.map((option) => (
                  <SelectItem
                    className="slot-select-item"
                    key={option.slot}
                    value={String(option.slot)}
                  >
                    <span className="slot-select-row">
                      <span className="slot-select-identity">
                        <b>App {option.slot}</b>
                        <small>Available</small>
                      </span>
                      <span className="slot-select-ports">
                        {option.apps
                          .map((app) => `${app.label} ${app.port}`)
                          .join(" · ")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {selected ? (
            <div className="port-preview">
              {selected.apps.map((app) => (
                <span key={`${app.label}:${app.port}`}>
                  <b>{app.label}</b>
                  <code>{app.port}</code>
                </span>
              ))}
            </div>
          ) : null}
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
            disabled={
              mutation.isPending || branch.trim() === "" || slot === null
            }
            type="submit"
          >
            {mutation.isPending ? "Creating…" : "Create worktree"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
