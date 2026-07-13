import { InfoIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import type {
  RepositoryCommandProfile,
  WorkgroveCommand,
} from "../../config/workgrove-command";
import { formatCommandLine, parseCommandLine } from "../command-line";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./ui/field";
import { Input } from "./ui/input";

function command(
  value: string,
  original: WorkgroveCommand | null
): WorkgroveCommand | null {
  if (!value.trim()) {
    return null;
  }
  const argv = parseCommandLine(value);
  if (argv.length === 0) {
    return null;
  }
  return {
    ...(original?.cwd ? { cwd: original.cwd } : {}),
    ...(original?.env ? { env: original.env } : {}),
    argv,
  };
}

function CommandField({
  description,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  description: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        autoComplete="off"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}

export function RepositoryCommandsDialog({
  configPath,
  error,
  onClose,
  onSave,
  open,
  pending,
  profile,
}: {
  configPath: string;
  error: Error | null;
  onClose: () => void;
  onSave: (value: {
    setup: WorkgroveCommand | null;
    start?: WorkgroveCommand | null;
  }) => void;
  open: boolean;
  pending: boolean;
  profile: RepositoryCommandProfile;
}) {
  const [setup, setSetup] = useState(() =>
    profile.setup ? formatCommandLine(profile.setup.argv) : ""
  );
  const [start, setStart] = useState(() =>
    profile.start ? formatCommandLine(profile.start.argv) : ""
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const perApp = profile.startMode === "per-app";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const value = {
        setup: command(setup, profile.setup),
        ...(perApp ? {} : { start: command(start, profile.start) }),
      };
      setValidationError(null);
      onSave(value);
    } catch (commandError) {
      setValidationError(
        commandError instanceof Error
          ? commandError.message
          : "Enter a valid command"
      );
    }
  }
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>Repository commands</DialogTitle>
          <DialogDescription>
            Commands run from each selected worktree and are saved in
            <code className="ml-1 break-all">{configPath}</code>. Stop always
            terminates the managed Start process and is not configurable.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <FieldGroup>
            <CommandField
              description="Prepares a worktree before development. Leave empty to disable."
              id="setup-command"
              label="Setup command"
              onChange={setSetup}
              placeholder="bun install"
              value={setup}
            />
            {perApp ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>Start is configured per app</AlertTitle>
                <AlertDescription>
                  This dialog will preserve those app commands. Edit them
                  directly in .workgrove.json when they need to differ.
                </AlertDescription>
              </Alert>
            ) : (
              <CommandField
                description="Runs until Workgrove stops its managed process tree."
                id="start-command"
                label="Start command"
                onChange={setStart}
                placeholder="bun dev"
                value={start}
              />
            )}
            {validationError ? (
              <FieldError>{validationError}</FieldError>
            ) : null}
            {error ? <FieldError>{error.message}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? "Saving…" : "Save commands"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
