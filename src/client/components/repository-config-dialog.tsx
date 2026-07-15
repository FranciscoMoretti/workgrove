import {
  CircleAlertIcon,
  InfoIcon,
  PlusIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkgroveCommand } from "../../config/workgrove-command";
import {
  nextAvailableWorkgroveAppBasePort,
  renameWorkgroveApp,
  resolveWorkgroveAppEndpoints,
} from "../../config/workgrove-editor";
import {
  canonicalizeWorkgroveConfig,
  WorkgroveAppIdSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  workgroveAppPortEnvironmentName,
} from "../../config/workgrove-schema";
import { formatCommandLine, parseCommandLine } from "../command-line";
import {
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "../config-draft";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Switch } from "./ui/switch";

function editableCommandLine(argv: string[]): string {
  return argv.length === 1 && argv[0] === "" ? "" : formatCommandLine(argv);
}

function CommandLineField({
  command,
  id,
  label,
  onChange,
  placeholder,
}: {
  command: WorkgroveCommand;
  id: string;
  label: string;
  onChange: (argv: string[]) => void;
  placeholder: string;
}) {
  const externalValue = editableCommandLine(command.argv);
  const [draft, setDraft] = useState(() => externalValue);
  const [parseError, setParseError] = useState<string | null>(null);
  const submittedValue = useRef(externalValue);

  useEffect(() => {
    if (externalValue !== submittedValue.current) {
      setDraft(externalValue);
      setParseError(null);
    }
    submittedValue.current = externalValue;
  }, [externalValue]);

  function update(nextDraft: string, normalize: boolean): void {
    setDraft(nextDraft);
    try {
      const argv = parseCommandLine(nextDraft);
      if (argv.length === 0) {
        throw new Error("Enter a command to run");
      }
      const formatted = formatCommandLine(argv);
      submittedValue.current = formatted;
      setParseError(null);
      if (normalize) {
        setDraft(formatted);
      }
      onChange(argv);
    } catch (caught) {
      submittedValue.current = "";
      setParseError(
        caught instanceof Error ? caught.message : "Enter a valid command"
      );
      onChange([]);
    }
  }

  return (
    <Field data-invalid={Boolean(parseError)}>
      <FieldLabel htmlFor={`${id}-command`}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <TerminalSquareIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-invalid={Boolean(parseError)}
          id={`${id}-command`}
          onBlur={() => update(draft, true)}
          onChange={(event) => update(event.target.value, false)}
          placeholder={placeholder}
          value={draft}
        />
      </InputGroup>
      <FieldError>{parseError}</FieldError>
    </Field>
  );
}

function CommandEditor({
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
  onChange: (value: WorkgroveCommand | undefined) => void;
  placeholder: string;
  value: WorkgroveCommand | undefined;
}) {
  const command = value ?? { argv: [""] };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <Field orientation="horizontal">
          <Switch
            aria-label={`Configure ${label.toLowerCase()}`}
            checked={value !== undefined}
            id={`${id}-enabled`}
            onCheckedChange={(checked) =>
              onChange(checked ? command : undefined)
            }
          />
          <FieldLabel htmlFor={`${id}-enabled`}>Configured</FieldLabel>
        </Field>
      </CardHeader>
      {value ? (
        <CardContent>
          <CommandLineField
            command={value}
            id={id}
            label="Command"
            onChange={(argv) => onChange({ argv })}
            placeholder={placeholder}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

function AppIdInput({
  id,
  onRename,
}: {
  id: string;
  onRename: (nextId: string) => string | null;
}) {
  const [draft, setDraft] = useState(id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(id), [id]);

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={`app-${id}-id`}>App identifier</FieldLabel>
      <Input
        aria-invalid={Boolean(error)}
        id={`app-${id}-id`}
        onBlur={() => setError(onRename(draft))}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        value={draft}
      />
      <FieldDescription>
        Used for the automatic port environment variable.
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function RepositoryConfigDialog({
  config,
  configPath,
  error,
  onClose,
  onSave,
  open,
  pending,
}: {
  config: WorkgroveConfig;
  configPath: string;
  error: Error | null;
  onClose: () => void;
  onSave: (value: WorkgroveConfig) => Promise<void>;
  open: boolean;
  pending: boolean;
}) {
  const [sourceConfig] = useState(() => canonicalizeWorkgroveConfig(config));
  const [draft, setDraft] = useState<WorkgroveConfig>(
    () => loadConfigDraft(configPath, sourceConfig) ?? sourceConfig
  );
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(sourceConfig);
  const validation = WorkgroveConfigSchema.safeParse(draft);

  useEffect(() => {
    if (open && isDirty) {
      saveConfigDraft(configPath, sourceConfig, draft);
    } else if (open) {
      clearConfigDraft(configPath);
    }
  }, [configPath, draft, isDirty, open, sourceConfig]);

  useEffect(() => {
    if (!(open && isDirty)) {
      return;
    }
    const preventUnsavedNavigation = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedNavigation);
    return () =>
      window.removeEventListener("beforeunload", preventUnsavedNavigation);
  }, [isDirty, open]);

  function requestClose(): void {
    if (isDirty) {
      setDiscardConfirmationOpen(true);
    } else {
      onClose();
    }
  }

  function renameApp(id: string, nextId: string): string | null {
    if (nextId === id) {
      return null;
    }
    const parsed = WorkgroveAppIdSchema.safeParse(nextId);
    if (!parsed.success) {
      return "Use only letters, numbers, underscores, and hyphens";
    }
    if (Object.hasOwn(draft.apps, nextId)) {
      return `App ${nextId} already exists`;
    }
    setDraft((current) => renameWorkgroveApp(current, id, nextId));
    return null;
  }

  function addApp(): void {
    let id = "app";
    let suffix = 2;
    while (Object.hasOwn(draft.apps, id)) {
      id = `app${suffix}`;
      suffix += 1;
    }
    setDraft((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [id]: { basePort: nextAvailableWorkgroveAppBasePort(current.apps) },
      },
    }));
  }

  function deleteApp(id: string): void {
    setDraft((current) => ({
      ...current,
      apps: Object.fromEntries(
        Object.entries(current.apps).filter(([appId]) => appId !== id)
      ),
    }));
  }

  async function save(): Promise<void> {
    if (!validation.success) {
      return;
    }
    await onSave(validation.data);
    clearConfigDraft(configPath);
  }

  const endpoints = (() => {
    try {
      return resolveWorkgroveAppEndpoints(draft, 0);
    } catch {
      return {};
    }
  })();
  const issues = validation.success ? [] : validation.error.issues;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Repository configuration</DialogTitle>
          <DialogDescription>
            Configure one setup command, one start command, and the apps they
            expose.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 p-6">
            <Alert>
              <InfoIcon />
              <AlertTitle>One implicit app group</AlertTitle>
              <AlertDescription>
                Start launches every app as one managed process tree. Each app
                receives an automatic WORKGROVE_*_PORT environment variable.
              </AlertDescription>
            </Alert>

            <div className="grid gap-4 md:grid-cols-2">
              <CommandEditor
                description="A finite command that prepares each worktree."
                id="repository-setup"
                label="Setup"
                onChange={(setup) =>
                  setDraft((current) => ({ ...current, setup }))
                }
                placeholder="bun install"
                value={draft.setup}
              />
              <CommandEditor
                description="A foreground command that starts all apps together."
                id="repository-start"
                label="Start"
                onChange={(start) =>
                  setDraft((current) => ({ ...current, start }))
                }
                placeholder="bun run dev"
                value={draft.start}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Apps</CardTitle>
                <CardDescription>
                  Apps are observable endpoints in the group. Workgrove derives
                  worktree ports and localhost URLs from each base port.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  {Object.entries(draft.apps).map(([id, app]) => (
                    <Card key={id}>
                      <CardContent className="grid gap-4 pt-6 md:grid-cols-[1fr_12rem_auto] md:items-start">
                        <AppIdInput
                          id={id}
                          onRename={(nextId) => renameApp(id, nextId)}
                        />
                        <Field>
                          <FieldLabel htmlFor={`app-${id}-port`}>
                            Base port
                          </FieldLabel>
                          <Input
                            id={`app-${id}-port`}
                            max={65_535}
                            min={1024}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                apps: {
                                  ...current.apps,
                                  [id]: {
                                    basePort:
                                      event.target.value === ""
                                        ? Number.NaN
                                        : Number(event.target.value),
                                  },
                                },
                              }))
                            }
                            type="number"
                            value={
                              Number.isNaN(app.basePort) ? "" : app.basePort
                            }
                          />
                          <FieldDescription>
                            {workgroveAppPortEnvironmentName(id)}
                            {endpoints[id] ? ` · ${endpoints[id].url}` : ""}
                          </FieldDescription>
                        </Field>
                        <Button
                          aria-label={`Delete ${id}`}
                          disabled={Object.keys(draft.apps).length === 1}
                          onClick={() => deleteApp(id)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2Icon />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  <Button
                    className="self-start"
                    onClick={addApp}
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add app
                  </Button>
                </FieldGroup>
              </CardContent>
            </Card>

            {issues.length > 0 ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Configuration needs attention</AlertTitle>
                <AlertDescription>
                  {issues.slice(0, 3).map((issue) => (
                    <div key={`${issue.path.join(".")}:${issue.message}`}>
                      {issue.path.join(".") || "config"}: {issue.message}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Could not save configuration</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center border-t bg-popover px-6 py-4">
          {discardConfirmationOpen ? (
            <>
              <p className="mr-auto text-muted-foreground">
                Discard unsaved configuration changes?
              </p>
              <Button
                onClick={() => setDiscardConfirmationOpen(false)}
                type="button"
                variant="outline"
              >
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  clearConfigDraft(configPath);
                  onClose();
                }}
                type="button"
                variant="destructive"
              >
                Discard changes
              </Button>
            </>
          ) : (
            <>
              <Button onClick={requestClose} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={!(isDirty && validation.success) || pending}
                onClick={save}
                type="button"
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
