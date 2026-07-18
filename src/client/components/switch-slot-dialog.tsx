import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";

import type {
  SlotOption,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import type { RequestRepositoryTrust } from "../use-repository-trust";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
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
import { Spinner } from "./ui/spinner";

export interface SlotSwitchTarget {
  appGroupName: string;
  slot: SlotOption;
  worktree: WorktreeSnapshot;
}

export function SwitchSlotDialog({
  onClose,
  onConfirm,
  requestRepositoryTrust,
  target,
}: {
  onClose: () => void;
  onConfirm: (target: SlotSwitchTarget) => Promise<unknown>;
  requestRepositoryTrust: RequestRepositoryTrust;
  target: SlotSwitchTarget | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!target) {
    return null;
  }
  const selection = target;

  function confirm() {
    requestRepositoryTrust("Switch the slot and restart apps", async () => {
      try {
        setError(null);
        setPending(true);
        await onConfirm(selection);
        onClose();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not switch the app slot"
        );
      } finally {
        setPending(false);
      }
    });
  }

  const group = target.worktree.appGroups.find(
    (candidate) => candidate.name === target.appGroupName
  );
  const currentSlot = group?.slot ?? "the current slot";
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!(open || pending)) {
          onClose();
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Switch to Slot {target.slot.slot}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target.appGroupName} for {target.worktree.name} is running in Slot{" "}
            {currentSlot}. Workgrove will stop it, assign Slot{" "}
            {target.slot.slot}, and start it again. The apps will be briefly
            unavailable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not switch the slot</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Switching…" : "Stop, switch & restart"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
