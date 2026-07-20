import { FolderGit2Icon, FolderOpenIcon, TreesIcon } from "lucide-react";
import type { FormEvent } from "react";

import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { useRepositoryOpen } from "../use-repository-open";
import { useRepositoryPicker } from "../use-repository-picker";
import { useRepositorySetup } from "../use-repository-setup";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { EmptyMedia } from "./ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

export function Onboarding({
  initialError,
  onDraftChange,
  onOpened,
  recents,
  repoDraft,
}: {
  initialError: Error | null;
  onDraftChange: (value: string) => void;
  onOpened: (path: string, snapshot: WorkspaceSnapshot) => void;
  recents: string[];
  repoDraft: string;
}) {
  const opener = useRepositoryOpen(onOpened, initialError);
  function changeDraft(path: string) {
    opener.clearError();
    picker.clearError();
    onDraftChange(path);
  }
  async function openSelected(path: string) {
    changeDraft(path);
    await opener.open(path);
  }
  const picker = useRepositoryPicker(openSelected);
  const setup = useRepositorySetup({
    error: opener.error,
    onCreated: () => opener.open(repoDraft.trim()),
    repoPath: repoDraft.trim(),
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const path = repoDraft.trim();
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
    return message ? <FieldError>{message}</FieldError> : null;
  }
  return (
    <main className="relative grid min-h-screen place-items-center bg-muted p-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-xl">
        <CardHeader>
          <EmptyMedia variant="icon">
            <TreesIcon />
          </EmptyMedia>
          <CardTitle>Keep every branch in its lane.</CardTitle>
          <CardDescription>
            Choose a Git repository. Workgrove will discover its worktrees from
            an existing <code>.workgrove.json</code>, or help you create a safe
            starter configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="onboarding-repo-path">
                  Repository path
                </FieldLabel>
                <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderGit2Icon />
                    </InputGroupAddon>
                    <InputGroupInput
                      autoFocus
                      disabled={opener.pending || picker.pending}
                      id="onboarding-repo-path"
                      onChange={(event) => changeDraft(event.target.value)}
                      placeholder="/Users/you/code/project"
                      value={repoDraft}
                    />
                  </InputGroup>
                  <Button
                    aria-label="Choose repository folder"
                    disabled={opener.pending || picker.pending}
                    onClick={picker.browse}
                    variant="outline"
                  >
                    <FolderOpenIcon data-icon="inline-start" />
                    {picker.pending ? "Opening…" : "Browse"}
                  </Button>
                </div>
              </Field>
              {feedback()}
              <Button
                className="w-full"
                disabled={
                  repoDraft.trim() === "" || opener.pending || picker.pending
                }
                type="submit"
              >
                {opener.pending ? "Inspecting…" : "Open repository"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        {recents.length > 0 ? (
          <CardFooter className="flex-col items-stretch gap-1">
            <FieldLabel>Recent repositories</FieldLabel>
            {recents.map((path) => (
              <Button
                className="w-full justify-start truncate"
                disabled={opener.pending || picker.pending}
                key={path}
                onClick={() => openSelected(path)}
                variant="ghost"
              >
                <FolderGit2Icon data-icon="inline-start" />
                {path}
              </Button>
            ))}
          </CardFooter>
        ) : null}
      </Card>
      {setup.dialog}
    </main>
  );
}
