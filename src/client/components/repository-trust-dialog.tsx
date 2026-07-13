import { AlertCircleIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

function trustButtonLabel(pending: boolean, actionLabel: string | null) {
  if (pending) {
    return "Trusting…";
  }
  return actionLabel ? "Trust and continue" : "Trust commands";
}

function dismissButtonLabel(actionLabel: string | null) {
  return actionLabel ? "Cancel" : "Continue without trusting";
}

export function RepositoryTrustDialog({
  actionLabel,
  commands,
  error,
  onClose,
  onTrust,
  open,
  pending,
  repoPath,
}: {
  actionLabel: string | null;
  commands: string[];
  error: Error | null;
  onClose: () => void;
  onTrust: () => Promise<void>;
  open: boolean;
  pending: boolean;
  repoPath: string;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || pending)) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Do you trust commands from this repository?</DialogTitle>
          <DialogDescription>
            {actionLabel ? (
              <>
                To {actionLabel.toLowerCase()}, Workgrove needs permission to
                run this repository&apos;s configured commands.
              </>
            ) : (
              <>
                Workgrove opened this repository in restricted mode. You can
                inspect it, but configured commands will not run until you trust
                them.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <code className="break-all bg-muted px-2 py-1.5 text-muted-foreground">
          {repoPath}
        </code>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Commands this repository can run</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {commands.map((command) => (
                <li key={command}>
                  <code className="break-all">{command}</code>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <p className="text-muted-foreground">
          Trust is saved for this repository. You can change its configured
          commands later without another prompt.
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not trust repository</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="outline">
            {dismissButtonLabel(actionLabel)}
          </Button>
          <Button disabled={pending} onClick={onTrust}>
            <ShieldCheckIcon data-icon="inline-start" />
            {trustButtonLabel(pending, actionLabel)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
