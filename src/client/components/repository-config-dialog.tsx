import {
  CircleAlertIcon,
  PlusIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkgroveCommand } from "../../config/workgrove-command";
import {
  addWorkgroveEnvironment,
  deleteWorkgroveEnvironment,
  nextAvailableWorkgroveAppBasePort,
  renameWorkgroveApp,
  renameWorkgroveEnvironment,
  resolveWorkgroveAppEndpoints,
} from "../../config/workgrove-editor";
import {
  cloneWorkgroveConfig,
  WorkgroveAppIdSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  WorkgroveEnvironmentNameSchema,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

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
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium text-sm">{label}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
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
      </div>
      {value ? (
        <CommandLineField
          command={value}
          id={id}
          label="Command"
          onChange={(argv) => onChange({ argv })}
          placeholder={placeholder}
        />
      ) : null}
    </section>
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
    <div className="space-y-1">
      <Input
        aria-invalid={Boolean(error)}
        aria-label={`App identifier ${id}`}
        id={`app-${id}-id`}
        onBlur={() => setError(onRename(draft))}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        value={draft}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function EnvironmentNameInput({
  name,
  onRename,
}: {
  name: string;
  onRename: (nextName: string) => string | null;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(name), [name]);

  return (
    <div className="space-y-1">
      <Input
        aria-invalid={Boolean(error)}
        aria-label={`Environment variable ${name}`}
        onBlur={() => setError(onRename(draft))}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        value={draft}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function SectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="font-medium text-base">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
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
  const [sourceConfig] = useState(() => cloneWorkgroveConfig(config));
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

  function renameEnvironment(name: string, nextName: string): string | null {
    if (nextName === name) {
      return null;
    }
    if (!WorkgroveEnvironmentNameSchema.safeParse(nextName).success) {
      return "Use a valid environment variable name";
    }
    if (Object.hasOwn(draft.env ?? {}, nextName)) {
      return `${nextName} already exists`;
    }
    setDraft((current) => renameWorkgroveEnvironment(current, name, nextName));
    return null;
  }

  function addEnvironment(): void {
    setDraft(addWorkgroveEnvironment);
  }

  function deleteEnvironment(name: string): void {
    setDraft((current) => deleteWorkgroveEnvironment(current, name));
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
          <div className="flex flex-col gap-7 p-6">
            <p className="max-w-3xl text-muted-foreground text-sm">
              Workgrove allocates endpoints and starts one repository command.
              Your repository owns how that command orchestrates its apps.
            </p>

            <section className="space-y-5">
              <SectionHeading
                description="Commands run from the repository root and share the environment configured below."
                title="Commands"
              />
              <div className="grid gap-6 md:grid-cols-2">
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
            </section>

            <Separator />

            <section className="grid gap-5 md:grid-cols-[1fr_14rem]">
              <SectionHeading
                description="The stride is the port offset between worktree slots. Slot 2 with stride 10 adds 20 to every base port."
                title="Port allocation"
              />
              <Field>
                <FieldLabel htmlFor="repository-stride">Stride</FieldLabel>
                <Input
                  id="repository-stride"
                  max={65_535}
                  min={1}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      stride:
                        event.target.value === ""
                          ? Number.NaN
                          : Number(event.target.value),
                    }))
                  }
                  type="number"
                  value={Number.isNaN(draft.stride) ? "" : draft.stride}
                />
              </Field>
            </section>

            <Separator />

            <section className="space-y-5">
              <SectionHeading
                description="Each app is an observable local endpoint. Its port is base port + slot × stride."
                title="Apps"
              />
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identifier</TableHead>
                      <TableHead className="w-40">Base port</TableHead>
                      <TableHead>Slot 0 endpoint</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(draft.apps).map(([id, app]) => (
                      <TableRow key={id}>
                        <TableCell className="min-w-48 whitespace-normal align-top">
                          <AppIdInput
                            id={id}
                            onRename={(nextId) => renameApp(id, nextId)}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            aria-label={`Base port for ${id}`}
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
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground">
                          {endpoints[id]?.url ?? "Invalid port"}
                        </TableCell>
                        <TableCell className="align-top">
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={addApp} type="button" variant="outline">
                <PlusIcon data-icon="inline-start" />
                Add app
              </Button>
            </section>

            <Separator />

            <section className="space-y-5">
              <SectionHeading
                description="Expose only the values your repository start script needs. Values may use {slot}, {apps.<id>.port}, or {apps.<id>.url}."
                title="Environment"
              />
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-64">Variable</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(draft.env ?? {}).length === 0 ? (
                      <TableRow>
                        <TableCell
                          className="py-6 text-center text-muted-foreground"
                          colSpan={3}
                        >
                          No repository environment variables exposed.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {Object.entries(draft.env ?? {}).map(([name, value]) => (
                      <TableRow key={name}>
                        <TableCell className="align-top">
                          <EnvironmentNameInput
                            name={name}
                            onRename={(nextName) =>
                              renameEnvironment(name, nextName)
                            }
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            aria-label={`Value for ${name}`}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                env: {
                                  ...current.env,
                                  [name]: event.target.value,
                                },
                              }))
                            }
                            placeholder={`{apps.${Object.keys(draft.apps)[0] ?? "app"}.port}`}
                            value={value}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Button
                            aria-label={`Delete ${name}`}
                            onClick={() => deleteEnvironment(name)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2Icon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={addEnvironment} type="button" variant="outline">
                <PlusIcon data-icon="inline-start" />
                Add variable
              </Button>
            </section>

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
