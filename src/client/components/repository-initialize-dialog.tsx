import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2Icon } from "lucide-react";

import { initializeRepository, previewRepositoryConfig } from "../api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

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
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Initialize Workgrove</DialogTitle>
          <DialogDescription>
            Review the detected settings before creating .workgrove.json.
          </DialogDescription>
        </DialogHeader>
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
                  <dt>Setup command</dt>
                  <dd>{preview.data.detectedSetupCommand ?? "Not detected"}</dd>
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
        <DialogFooter>
          <Button
            disabled={create.isPending}
            onClick={onClose}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!preview.data || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
