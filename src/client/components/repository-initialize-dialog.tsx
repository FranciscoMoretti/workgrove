import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2Icon } from "lucide-react";

import { initializeRepository, previewRepositoryConfig } from "../api";
import { Modal } from "./modal";
import { Button } from "./ui/button";

export function RepositoryInitializeDialog({
  onClose,
  onCreated,
  open,
  repoPath,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  open: boolean;
  repoPath: string;
}) {
  const preview = useQuery({
    enabled: open,
    queryFn: () => previewRepositoryConfig(repoPath),
    queryKey: ["repository-initialization", repoPath],
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => initializeRepository(repoPath),
    onSuccess: onCreated,
  });
  const error = preview.error ?? create.error;
  return (
    <Modal onClose={onClose} open={open} title="Initialize Workgrove">
      <div className="modal-copy initialize-copy">
        <div className="initialize-intro">
          <FilePlus2Icon />
          <div>
            <strong>Create a starter worktree configuration</strong>
            <p>
              Workgrove detected this repository and prepared a conservative
              single-app configuration. Nothing is written until you confirm.
            </p>
          </div>
        </div>
        {preview.data ? (
          <>
            <dl className="detection-grid">
              <div>
                <dt>Detected runtime</dt>
                <dd>{preview.data.detectedRuntime}</dd>
              </div>
              <div>
                <dt>Dev command</dt>
                <dd>{preview.data.detectedStartCommand ?? "Not detected"}</dd>
              </div>
            </dl>
            {preview.data.detectedStartCommand ? null : (
              <p className="setup-warning">
                No safe start command was detected. Add an app
                <code> start</code> command before using Start.
              </p>
            )}
            <pre className="config-preview">
              {JSON.stringify(preview.data.config, null, 2)}
            </pre>
            <code className="config-destination">
              {preview.data.configPath}
            </code>
          </>
        ) : null}
        {preview.isLoading ? <p>Inspecting repository…</p> : null}
        {error ? <p className="field-error">{error.message}</p> : null}
      </div>
      <div className="modal-actions">
        <Button
          disabled={create.isPending}
          onClick={onClose}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={!preview.data || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating…" : "Create configuration"}
        </Button>
      </div>
    </Modal>
  );
}
