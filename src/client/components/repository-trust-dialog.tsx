import { AlertCircleIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
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

function reviewedCommand(value: string): {
  command: string;
  description: string;
  label: string;
} {
  const separator = value.indexOf(": ");
  const label = separator === -1 ? "Command" : value.slice(0, separator);
  const command = separator === -1 ? value : value.slice(separator + 2);
  const description =
    label === "Setup"
      ? "Prepares a newly created worktree."
      : "Starts the app group as one managed process tree.";
  return { command, description, label };
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
          <DialogTitle>Trust repository commands?</DialogTitle>
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
        <div className="flex flex-col gap-2">
          {commands.map((value) => {
            const item = reviewedCommand(value);
            return (
              <Card key={value} size="sm">
                <CardHeader>
                  <CardTitle>{item.label}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <code className="block break-all bg-muted px-2 py-1.5">
                    {item.command}
                  </code>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-muted-foreground">
          Trust is saved for this command fingerprint. Workgrove asks again if
          the configured commands change.
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
