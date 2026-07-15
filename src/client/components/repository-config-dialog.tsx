import { zodResolver } from "@hookform/resolvers/zod";
import {
  AppWindowIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CopyIcon,
  HomeIcon,
  InfoIcon,
  NetworkIcon,
  PlusIcon,
  Settings2Icon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import type { WorkgroveCommand } from "../../config/workgrove-command";
import {
  nextAvailableWorkgroveAppPort,
  renameWorkgroveApp,
  resolveWorkgroveAppEndpoints,
  type WorkgroveLaunchMode,
  withWorkgroveLaunchMode,
  workgroveAppReferenceCount,
  workgroveLaunchMode,
} from "../../config/workgrove-editor";
import {
  canonicalizeWorkgroveConfig,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  WorkgroveAppIdSchema,
  type WorkgroveAppPort,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "../../config/workgrove-schema";
import { formatCommandLine, parseCommandLine } from "../command-line";
import {
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "../config-draft";
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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const PREVIEW_SLOTS = [0, 1, 2] as const;

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }
  for (const value of Object.values(error)) {
    const message = errorMessage(value);
    if (message) {
      return message;
    }
  }
  return undefined;
}

function directErrorMessage(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : undefined;
}

function KeyValueEditor({
  addLabel,
  id,
  onChange,
  value,
}: {
  addLabel: string;
  id: string;
  onChange: (value: Record<string, string> | undefined) => void;
  value: Record<string, string> | undefined;
}) {
  const entries = Object.entries(value ?? {});

  function updateEntry(index: number, key: string, entryValue: string): void {
    const duplicate = entries.some(
      ([existingKey], entryIndex) => entryIndex !== index && existingKey === key
    );
    if (!key || duplicate) {
      return;
    }
    const next = [...entries];
    next[index] = [key, entryValue];
    onChange(Object.fromEntries(next));
  }

  function removeEntry(index: number): void {
    const next = entries.filter((_, entryIndex) => entryIndex !== index);
    onChange(next.length > 0 ? Object.fromEntries(next) : undefined);
  }

  function addEntry(): void {
    let key = "NAME";
    let suffix = 2;
    while (Object.hasOwn(value ?? {}, key)) {
      key = `NAME_${suffix}`;
      suffix += 1;
    }
    onChange({ ...value, [key]: "" });
  }

  return (
    <FieldGroup>
      {entries.map(([key, entryValue], index) => (
        <div className="flex items-center gap-2" key={`${id}:${key}`}>
          <Input
            aria-label={`${addLabel} name`}
            className="font-mono"
            onChange={(event) =>
              updateEntry(index, event.target.value, entryValue)
            }
            value={key}
          />
          <Input
            aria-label={`${addLabel} value`}
            className="font-mono"
            onChange={(event) => updateEntry(index, key, event.target.value)}
            value={entryValue}
          />
          <Button
            aria-label={`Remove ${key}`}
            onClick={() => removeEntry(index)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button onClick={addEntry} size="sm" type="button" variant="outline">
        <PlusIcon data-icon="inline-start" />
        {addLabel}
      </Button>
    </FieldGroup>
  );
}

function editableCommandLine(argv: string[]): string {
  return argv.length === 1 && argv[0] === "" ? "" : formatCommandLine(argv);
}

function CommandLineField({
  command,
  error,
  id,
  label,
  onChange,
}: {
  command: WorkgroveCommand;
  error?: string;
  id: string;
  label: string;
  onChange: (argv: string[]) => void;
}) {
  const externalValue = editableCommandLine(command.argv);
  const [draft, setDraft] = useState(() => externalValue);
  const [parseError, setParseError] = useState<string | null>(null);
  const submittedValue = useRef(externalValue);
  const invalid = Boolean(error || parseError);

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
      const formatted = editableCommandLine(argv);
      setParseError(null);
      submittedValue.current = formatted;
      if (normalize) {
        setDraft(formatted);
      }
      onChange(argv);
    } catch (caught) {
      setParseError(
        caught instanceof Error ? caught.message : "Enter a valid command"
      );
      submittedValue.current = "";
      onChange([]);
    }
  }

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={`${id}-command-line`}>Command</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <TerminalSquareIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-invalid={invalid}
          aria-label={`${label} command`}
          className="font-mono"
          id={`${id}-command-line`}
          onBlur={() => update(draft, true)}
          onChange={(event) => update(event.target.value, false)}
          placeholder="bun run dev"
          value={draft}
        />
      </InputGroup>
      <FieldDescription>
        Parsed into executable arguments without invoking a shell. Templates
        include <code>{"{port}"}</code>, <code>{"{slot}"}</code>, and{" "}
        <code>{"{apps.api.url}"}</code>.
      </FieldDescription>
      <FieldError>{parseError ?? error}</FieldError>
    </Field>
  );
}

function CommandEditor({
  description,
  error,
  id,
  label,
  onChange,
  value,
}: {
  description: string;
  error?: string;
  id: string;
  label: string;
  onChange: (value: WorkgroveCommand | undefined) => void;
  value: WorkgroveCommand | undefined;
}) {
  const enabled = value !== undefined;
  const command = value ?? { argv: [""] };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Field orientation="horizontal">
            <FieldLabel htmlFor={`${id}-enabled`}>Configured</FieldLabel>
            <Switch
              checked={enabled}
              id={`${id}-enabled`}
              onCheckedChange={(checked) =>
                onChange(checked ? command : undefined)
              }
            />
          </Field>
        </CardAction>
      </CardHeader>
      {enabled ? (
        <CardContent>
          <FieldGroup className="gap-4">
            <CommandLineField
              command={command}
              error={error}
              id={id}
              label={label}
              onChange={(argv) => onChange({ ...command, argv })}
            />
            <Field>
              <FieldLabel htmlFor={`${id}-cwd`}>Working directory</FieldLabel>
              <Input
                className="font-mono"
                id={`${id}-cwd`}
                onChange={(event) =>
                  onChange({
                    ...command,
                    cwd: event.target.value || undefined,
                  })
                }
                placeholder="Optional, relative to the worktree"
                value={command.cwd ?? ""}
              />
              <FieldDescription>
                Optional path relative to each worktree root.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Environment variables</FieldLabel>
              <KeyValueEditor
                addLabel="Add variable"
                id={`${id}-environment`}
                onChange={(env) => onChange({ ...command, env })}
                value={command.env}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      ) : null}
    </Card>
  );
}

function AppIdInput({
  invalid,
  id,
  onRename,
}: {
  invalid: boolean;
  id: string;
  onRename: (nextId: string) => void;
}) {
  const [draft, setDraft] = useState(id);
  return (
    <Input
      aria-invalid={invalid}
      aria-label="App identifier"
      className="font-mono"
      id={`app-${id}-identifier`}
      onBlur={() => onRename(draft)}
      onChange={(event) => setDraft(event.target.value)}
      value={draft}
    />
  );
}

type BuilderSection = "advanced" | "apps" | "commands" | "overview" | "ports";

function launchModeDescription(
  mode: WorkgroveLaunchMode,
  noun: "command" | "launch"
): string {
  if (mode === "aggregate") {
    return noun === "command" ? "Aggregate start" : "Aggregate launch";
  }
  if (mode === "per-app") {
    return noun === "command" ? "Per-app start" : "Per-app launch";
  }
  return noun === "command" ? "No start command" : "No launch command";
}

function LaunchModeEditor({
  onChange,
  value,
}: {
  onChange: (value: WorkgroveLaunchMode) => void;
  value: WorkgroveLaunchMode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="config-launch-mode">Launch mode</FieldLabel>
      <Select
        onValueChange={(nextValue) =>
          onChange(nextValue as WorkgroveLaunchMode)
        }
        value={value}
      >
        <SelectTrigger id="config-launch-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="none">No managed start command</SelectItem>
            <SelectItem value="aggregate">One aggregate process</SelectItem>
            <SelectItem value="per-app">One process per app</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>
        Aggregate mode runs one command for the repository. Per-app mode lets
        Workgrove start and stop apps independently.
      </FieldDescription>
    </Field>
  );
}

function PortAllocationEditor({
  error,
  id,
  onChange,
  ports,
  value,
}: {
  error: unknown;
  id: string;
  onChange: (value: WorkgroveAppPort) => void;
  ports: WorkgroveConfig["ports"];
  value: WorkgroveAppPort;
}) {
  const numericValue = value.base;
  return (
    <Field className="md:col-span-2" data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={`${id}-port`}>Slot 0 port</FieldLabel>
      <FieldDescription>
        Use this app&apos;s conventional development port, such as 3000 for a
        web app or 8000 for FastAPI.
      </FieldDescription>
      <Input
        aria-invalid={Boolean(error)}
        id={`${id}-port`}
        max={65_535}
        min={1024}
        onChange={(event) =>
          onChange({
            base:
              event.target.value === ""
                ? Number.NaN
                : Number(event.target.value),
          })
        }
        type="number"
        value={Number.isNaN(numericValue) ? "" : numericValue}
      />
      <div className="flex flex-wrap gap-2" role="status">
        {PREVIEW_SLOTS.map((slot) => (
          <Badge key={slot} variant="outline">
            Slot {slot} <code>{numericValue + slot * ports.slotStride}</code>
          </Badge>
        ))}
      </div>
      <FieldError>{errorMessage(error)}</FieldError>
    </Field>
  );
}

function AppEditor({
  app,
  appCount,
  appError,
  id,
  onDelete,
  onDuplicate,
  onRename,
  ports,
  showStartCommand,
  control,
}: {
  app: WorkgroveApp;
  appCount: number;
  appError: unknown;
  id: string;
  onDelete: () => string | undefined;
  onDuplicate: () => void;
  onRename: (nextId: string) => string | undefined;
  ports: WorkgroveConfig["ports"];
  showStartCommand: boolean;
  control: ReturnType<typeof useForm<WorkgroveConfig>>["control"];
}) {
  const [pane, setPane] = useState<"environment" | "settings" | "start">(
    "settings"
  );
  const startError = errorMessage(
    (appError as { start?: unknown } | undefined)?.start
  );
  const idError = directErrorMessage(appError);
  const [renameError, setRenameError] = useState<string | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const displayedIdError = renameError ?? idError;
  return (
    <Card className="h-full gap-0 overflow-visible py-0 ring-0">
      <CardHeader className="border-b py-4">
        <div className="flex items-start justify-between gap-4 max-sm:flex-col">
          <div className="min-w-0">
            <CardTitle>{app.control?.label || id}</CardTitle>
            <CardDescription>
              App identity, port allocation, runtime controls, and process
              command.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              onClick={onDuplicate}
              size="sm"
              type="button"
              variant="outline"
            >
              <CopyIcon data-icon="inline-start" />
              Duplicate
            </Button>
            <Button
              aria-label={`Delete ${id}`}
              disabled={appCount === 1}
              onClick={() => setDeleteError(onDelete())}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
        {deleteError ? (
          <p className="text-destructive text-xs">{deleteError}</p>
        ) : null}
      </CardHeader>
      <div className="flex items-center gap-1 overflow-x-auto border-b px-4 py-2">
        <Button
          onClick={() => setPane("settings")}
          size="sm"
          type="button"
          variant={pane === "settings" ? "secondary" : "ghost"}
        >
          App settings
        </Button>
        <Button
          onClick={() => setPane("environment")}
          size="sm"
          type="button"
          variant={pane === "environment" ? "secondary" : "ghost"}
        >
          Exported environment
        </Button>
        <Button
          onClick={() => setPane("start")}
          size="sm"
          type="button"
          variant={pane === "start" ? "secondary" : "ghost"}
        >
          Start command
        </Button>
      </div>
      <CardContent className="py-5">
        <FieldGroup>
          {pane === "settings" ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field data-invalid={Boolean(displayedIdError)}>
                <FieldLabel htmlFor={`app-${id}-identifier`}>
                  App identifier
                </FieldLabel>
                <AppIdInput
                  id={id}
                  invalid={Boolean(displayedIdError)}
                  onRename={(nextId) => setRenameError(onRename(nextId))}
                />
                <FieldDescription>
                  Letters, numbers, underscores, and hyphens.
                </FieldDescription>
                <FieldError>{displayedIdError}</FieldError>
              </Field>
              <Controller
                control={control}
                name={`apps.${id}.control.label`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={`app-${id}-label`}>Label</FieldLabel>
                    <Input
                      id={`app-${id}-label`}
                      onChange={(event) =>
                        field.onChange(event.target.value || undefined)
                      }
                      value={field.value ?? ""}
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name={`apps.${id}.port`}
                render={({ field, fieldState }) => (
                  <PortAllocationEditor
                    error={fieldState.error}
                    id={`app-${id}`}
                    onChange={field.onChange}
                    ports={ports}
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name={`apps.${id}.control.probe`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={`app-${id}-probe`}>
                      Health probe
                    </FieldLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? "tcp"}
                    >
                      <SelectTrigger id={`app-${id}-probe`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="tcp">TCP port</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <div className="flex flex-col gap-3 pt-6">
                <Controller
                  control={control}
                  name={`apps.${id}.control.required`}
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Checkbox
                        checked={
                          field.value ?? (app.control?.probe ?? "tcp") === "tcp"
                        }
                        id={`app-${id}-required`}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                      <FieldLabel htmlFor={`app-${id}-required`}>
                        Required
                      </FieldLabel>
                    </Field>
                  )}
                />
                <Controller
                  control={control}
                  name={`apps.${id}.control.open`}
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Checkbox
                        checked={field.value ?? false}
                        id={`app-${id}-open`}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                      <FieldLabel htmlFor={`app-${id}-open`}>
                        Show open action
                      </FieldLabel>
                    </Field>
                  )}
                />
              </div>
            </div>
          ) : null}
          {pane === "environment" ? (
            <Controller
              control={control}
              name={`apps.${id}.exports`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>Exported environment</FieldLabel>
                  <FieldDescription>
                    Values supplied to this app and available as templates.
                  </FieldDescription>
                  <KeyValueEditor
                    addLabel="Add export"
                    id={`app-${id}-exports`}
                    onChange={field.onChange}
                    value={field.value}
                  />
                </Field>
              )}
            />
          ) : null}
          {pane === "start" && showStartCommand ? (
            <Controller
              control={control}
              name={`apps.${id}.start`}
              render={({ field }) => (
                <CommandEditor
                  description="Run this app as an independently managed process."
                  error={startError}
                  id={`app-${id}-start`}
                  label="Start command"
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
          ) : null}
          {pane === "start" && !showStartCommand ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Per-app launch mode is off</AlertTitle>
              <AlertDescription>
                Choose “One process per app” under Repository commands to
                configure an individual command here.
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this component coordinates one shared form across the builder's app, command, slot, preview, and validation surfaces.
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
  const [restoredDraft] = useState(() =>
    loadConfigDraft(configPath, sourceConfig)
  );
  const [draftHydrated, setDraftHydrated] = useState(restoredDraft === null);
  const form = useForm<WorkgroveConfig>({
    defaultValues: sourceConfig,
    mode: "onChange",
    resolver: zodResolver(WorkgroveConfigSchema),
  });
  const [section, setSection] = useState<BuilderSection>("overview");
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState(
    () => Object.keys(config.apps)[0] ?? ""
  );
  const apps = useWatch({ control: form.control, name: "apps" }) ?? {};
  const draft = useWatch({ control: form.control });
  const appEntries = Object.entries(apps);
  const errors = form.formState.errors;
  const launchMode = workgroveLaunchMode({
    apps,
    control: form.getValues("control"),
  });
  const isDirty = JSON.stringify(draft) !== JSON.stringify(sourceConfig);

  useEffect(() => {
    if (restoredDraft) {
      form.reset(restoredDraft, { keepDefaultValues: true });
    }
    setDraftHydrated(true);
  }, [form, restoredDraft]);

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

  useEffect(() => {
    if (!(open && draftHydrated)) {
      return;
    }
    if (isDirty) {
      saveConfigDraft(configPath, sourceConfig, draft);
    } else {
      clearConfigDraft(configPath);
    }
  }, [configPath, draft, draftHydrated, isDirty, open, sourceConfig]);

  function requestClose(): void {
    if (isDirty) {
      setDiscardConfirmationOpen(true);
      return;
    }
    onClose();
  }

  function discardAndClose(): void {
    clearConfigDraft(configPath);
    setDiscardConfirmationOpen(false);
    onClose();
  }

  function changeLaunchMode(mode: WorkgroveLaunchMode): void {
    const next = withWorkgroveLaunchMode(
      { apps, control: form.getValues("control") },
      mode
    );
    form.setValue("apps", next.apps, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("control", next.control, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function addApp(): void {
    let id = "app";
    let suffix = 2;
    while (Object.hasOwn(apps, id)) {
      id = `app${suffix}`;
      suffix += 1;
    }
    const port = nextAvailableWorkgroveAppPort(apps);
    form.setValue(
      "apps",
      { ...apps, [id]: { port } },
      { shouldDirty: true, shouldValidate: true }
    );
    setSelectedAppId(id);
    setSection("apps");
  }

  function renameApp(id: string, nextId: string): string | undefined {
    if (nextId === id) {
      return undefined;
    }
    const parsedId = WorkgroveAppIdSchema.safeParse(nextId);
    if (!parsedId.success) {
      return parsedId.error.issues[0]?.message ?? "Invalid app identifier";
    }
    if (Object.hasOwn(apps, nextId)) {
      return `App ${nextId} already exists`;
    }
    const next = renameWorkgroveApp(form.getValues(), id, nextId);
    form.clearErrors("apps");
    form.setValue("apps", next.apps, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("control", next.control, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("url", next.url, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setSelectedAppId(nextId);
    return undefined;
  }

  function duplicateApp(id: string): void {
    const source = apps[id];
    if (!source) {
      return;
    }
    let nextId = `${id}Copy`;
    let suffix = 2;
    while (Object.hasOwn(apps, nextId)) {
      nextId = `${id}Copy${suffix}`;
      suffix += 1;
    }
    const port = nextAvailableWorkgroveAppPort(apps);
    form.setValue(
      "apps",
      {
        ...apps,
        [nextId]: { ...structuredClone(source), port },
      },
      { shouldDirty: true, shouldValidate: true }
    );
    setSelectedAppId(nextId);
  }

  function deleteApp(id: string): string | undefined {
    const references = workgroveAppReferenceCount(form.getValues(), id);
    if (references > 0) {
      return `Remove or change ${references} template ${references === 1 ? "reference" : "references"} to ${id} before deleting this app.`;
    }
    const remaining = appEntries.filter(([appId]) => appId !== id);
    form.setValue("apps", Object.fromEntries(remaining), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setSelectedAppId(remaining[0]?.[0] ?? "");
    return undefined;
  }

  const validation = WorkgroveConfigSchema.safeParse(draft);
  const validationIssues = validation.success ? [] : validation.error.issues;
  const selectedApp = apps[selectedAppId] ?? appEntries[0]?.[1];
  const effectiveSelectedAppId = apps[selectedAppId]
    ? selectedAppId
    : (appEntries[0]?.[0] ?? "");
  const stride = draft.ports?.slotStride ?? 0;

  function previewPort(app: WorkgroveApp, slot: number): number {
    return resolveWorkgroveAppPort(
      { ports: { slotStride: stride } },
      app,
      slot
    );
  }

  function previewUrl(app: WorkgroveApp, slot: number): string {
    try {
      const id = appEntries.find(([, candidate]) => candidate === app)?.[0];
      if (!id) {
        return "Preview unavailable";
      }
      return resolveWorkgroveAppEndpoints(form.getValues(), slot)[id].url;
    } catch {
      return "Preview unavailable";
    }
  }

  function resetChanges(): void {
    clearConfigDraft(configPath);
    form.reset(sourceConfig);
    setSelectedAppId(Object.keys(config.apps)[0] ?? "");
    setSection("overview");
  }

  function portsAndSlots() {
    return (
      <section className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="font-heading font-medium text-base">Ports & slots</h2>
          <p className="text-muted-foreground text-xs/relaxed">
            Every app defines its own slot-zero port. The shared stride moves
            all app ports together for each worktree slot.
          </p>
        </div>
        <FieldGroup>
          <div className="grid gap-5 md:grid-cols-2">
            <Controller
              control={form.control}
              name="ports.slotStride"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="config-slot-stride">
                    Slot stride
                  </FieldLabel>
                  <Input
                    aria-invalid={fieldState.invalid}
                    id="config-slot-stride"
                    max={65_535}
                    min={1}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                    type="number"
                    value={field.value}
                  />
                  <FieldDescription>
                    Ports reserved for each worktree slot.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="slot.default"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="config-slot-default">
                    Default slot
                  </FieldLabel>
                  <Input
                    aria-invalid={fieldState.invalid}
                    id="config-slot-default"
                    min={0}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                    type="number"
                    value={field.value}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="slot.env"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="config-slot-env">
                    Slot environment variable
                  </FieldLabel>
                  <Input
                    aria-invalid={fieldState.invalid}
                    className="font-mono"
                    id="config-slot-env"
                    {...field}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="slot.file"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="config-slot-file">Slot file</FieldLabel>
                  <Input
                    aria-invalid={fieldState.invalid}
                    className="font-mono"
                    id="config-slot-file"
                    onChange={(event) =>
                      field.onChange(event.target.value || undefined)
                    }
                    value={field.value ?? ""}
                  />
                  <FieldDescription>
                    Optional; defaults to .env.worktree.local.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="url"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="config-url">App URL template</FieldLabel>
                  <Input
                    aria-invalid={fieldState.invalid}
                    className="font-mono"
                    id="config-url"
                    {...field}
                  />
                  <FieldDescription>
                    Supports {"{port}"} and {"{slot}"} templates.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
        </FieldGroup>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Slot preview</CardTitle>
            <CardDescription>
              Computed from the current unsaved app ports and slot stride.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  {PREVIEW_SLOTS.map((slot) => (
                    <TableHead key={slot}>
                      Slot {slot}
                      {slot === draft.slot?.default ? " · default" : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {appEntries.map(([id, app]) => (
                  <TableRow key={id}>
                    <TableCell className="font-medium">
                      {app.control?.label || id}
                    </TableCell>
                    {PREVIEW_SLOTS.map((slot) => (
                      <TableCell key={`${id}:${slot}`}>
                        <div className="flex flex-col gap-1">
                          <code>{previewPort(app, slot)}</code>
                          <code className="text-muted-foreground">
                            {previewUrl(app, slot)}
                          </code>
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    );
  }

  function repositoryCommands() {
    return (
      <section className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="font-heading font-medium text-base">
            Repository commands
          </h2>
          <p className="text-muted-foreground text-xs/relaxed">
            Configure worktree setup and choose one launch strategy.
          </p>
        </div>
        <Alert>
          <InfoIcon />
          <AlertTitle>Commands require repository trust</AlertTitle>
          <AlertDescription>
            Changing an executable command invalidates its existing approval
            fingerprint.
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <LaunchModeEditor onChange={changeLaunchMode} value={launchMode} />
          <Controller
            control={form.control}
            name="control.setup"
            render={({ field, fieldState }) => (
              <CommandEditor
                description="Prepare a worktree before development."
                error={errorMessage(fieldState.error)}
                id="config-setup"
                label="Setup command"
                onChange={field.onChange}
                value={field.value}
              />
            )}
          />
          {launchMode === "aggregate" ? (
            <Controller
              control={form.control}
              name="control.start"
              render={({ field, fieldState }) => (
                <CommandEditor
                  description="Start every app in one managed process."
                  error={errorMessage(fieldState.error)}
                  id="config-start"
                  label="Aggregate start command"
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
          ) : null}
        </FieldGroup>
      </section>
    );
  }

  function advancedSettings() {
    return (
      <section className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="font-heading font-medium text-base">Advanced</h2>
          <p className="text-muted-foreground text-xs/relaxed">
            Schema declaration and configuration format version.
          </p>
        </div>
        <FieldGroup>
          <Controller
            control={form.control}
            name="$schema"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="config-schema">JSON Schema URL</FieldLabel>
                <Input
                  aria-invalid={fieldState.invalid}
                  className="font-mono"
                  id="config-schema"
                  onChange={(event) =>
                    field.onChange(event.target.value || undefined)
                  }
                  value={field.value ?? ""}
                />
                <FieldDescription>
                  Optional editor and tooling hint.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Field data-disabled>
            <FieldLabel htmlFor="config-version">
              Configuration version
            </FieldLabel>
            <Input disabled id="config-version" type="number" value={1} />
            <FieldDescription>
              Version 1 is the only supported format.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </section>
    );
  }

  function overview() {
    return (
      <section className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="font-heading font-medium text-base">
            Configuration overview
          </h2>
          <p className="text-muted-foreground text-xs/relaxed">
            Build the repository model by adding apps, then configure commands
            and slots.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{appEntries.length} configured apps</CardTitle>
              <CardDescription>
                Each app has its own port allocation, controls, exports, and
                optional start command.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setSection("apps")}
                type="button"
                variant="outline"
              >
                <BoxesIcon data-icon="inline-start" />
                Manage apps
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                {launchModeDescription(launchMode, "launch")}
              </CardTitle>
              <CardDescription>
                Setup and start commands are represented as argv arrays without
                invoking a shell.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setSection("commands")}
                type="button"
                variant="outline"
              >
                <TerminalSquareIcon data-icon="inline-start" />
                Configure commands
              </Button>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              Apps at default slot {draft.slot?.default ?? 0}
            </CardTitle>
            <CardDescription>
              Live preview from the current unsaved configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {appEntries.map(([id, app]) => (
              <div
                className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0"
                key={id}
              >
                <span className="flex items-center gap-2 font-medium">
                  <AppWindowIcon />
                  {app.control?.label || id}
                </span>
                <code>{previewUrl(app, draft.slot?.default ?? 0)}</code>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    );
  }

  function centerContent() {
    if (section === "apps") {
      return selectedApp ? (
        <div className="p-4">
          <div className="mb-4 lg:hidden">
            <Field>
              <FieldLabel htmlFor="mobile-app-selector">
                Selected app
              </FieldLabel>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Select
                  onValueChange={(value) => {
                    if (value) {
                      setSelectedAppId(value);
                    }
                  }}
                  value={effectiveSelectedAppId}
                >
                  <SelectTrigger
                    className="min-w-0 flex-1"
                    id="mobile-app-selector"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {appEntries.map(([id]) => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button onClick={addApp} type="button" variant="outline">
                  <PlusIcon data-icon="inline-start" />
                  Add app
                </Button>
              </div>
            </Field>
          </div>
          <AppEditor
            app={selectedApp}
            appCount={appEntries.length}
            appError={errors.apps?.[effectiveSelectedAppId]}
            control={form.control}
            id={effectiveSelectedAppId}
            key={effectiveSelectedAppId}
            onDelete={() => deleteApp(effectiveSelectedAppId)}
            onDuplicate={() => duplicateApp(effectiveSelectedAppId)}
            onRename={(nextId) => renameApp(effectiveSelectedAppId, nextId)}
            ports={{ slotStride: stride }}
            showStartCommand={launchMode === "per-app"}
          />
        </div>
      ) : null;
    }
    if (section === "commands") {
      return repositoryCommands();
    }
    if (section === "ports") {
      return portsAndSlots();
    }
    if (section === "advanced") {
      return advancedSettings();
    }
    return overview();
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
      open={open}
    >
      <DialogContent className="h-[calc(100vh-1rem)] max-w-[calc(100%-1rem)] gap-0 p-0 sm:max-w-[calc(100%-1rem)]">
        <form
          className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
          onSubmit={form.handleSubmit(async (value) => {
            await onSave(canonicalizeWorkgroveConfig(value));
            clearConfigDraft(configPath);
          })}
        >
          <header className="flex items-center justify-between gap-4 border-b px-5 py-3 pr-12 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-md:items-start">
            <DialogHeader className="min-w-0">
              <DialogTitle className="text-base">
                Configuration builder
              </DialogTitle>
              <DialogDescription className="truncate font-mono">
                {configPath}
              </DialogDescription>
            </DialogHeader>
            <div className="flex shrink-0 items-center gap-2 max-sm:grid max-sm:grid-cols-2">
              <Button
                disabled={pending || !isDirty}
                onClick={resetChanges}
                type="button"
                variant="outline"
              >
                Discard changes
              </Button>
              <Button
                disabled={pending || !isDirty || !validation.success}
                type="submit"
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </div>
          </header>
          <div className="grid min-h-0 min-w-0 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r bg-muted/20 max-lg:hidden">
              <nav className="flex flex-col gap-1 p-3">
                <Button
                  className="justify-start"
                  onClick={() => setSection("overview")}
                  type="button"
                  variant={section === "overview" ? "secondary" : "ghost"}
                >
                  <HomeIcon data-icon="inline-start" />
                  Overview
                </Button>
                <Button
                  className="justify-start"
                  onClick={() => setSection("apps")}
                  type="button"
                  variant={section === "apps" ? "secondary" : "ghost"}
                >
                  <BoxesIcon data-icon="inline-start" />
                  Apps
                </Button>
                <div className="flex flex-col gap-1 pl-3">
                  {appEntries.map(([id, app]) => (
                    <Button
                      className="justify-between"
                      key={id}
                      onClick={() => {
                        setSelectedAppId(id);
                        setSection("apps");
                      }}
                      size="sm"
                      type="button"
                      variant={
                        section === "apps" && effectiveSelectedAppId === id
                          ? "secondary"
                          : "ghost"
                      }
                    >
                      <span className="truncate">
                        {app.control?.label || id}
                      </span>
                      <code>{previewPort(app, draft.slot?.default ?? 0)}</code>
                    </Button>
                  ))}
                  <Button
                    className="justify-start"
                    onClick={addApp}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add app
                  </Button>
                </div>
                <Button
                  className="justify-start"
                  onClick={() => setSection("commands")}
                  type="button"
                  variant={section === "commands" ? "secondary" : "ghost"}
                >
                  <TerminalSquareIcon data-icon="inline-start" />
                  Repository commands
                </Button>
                <Button
                  className="justify-start"
                  onClick={() => setSection("ports")}
                  type="button"
                  variant={section === "ports" ? "secondary" : "ghost"}
                >
                  <NetworkIcon data-icon="inline-start" />
                  Ports & slots
                </Button>
                <Button
                  className="justify-start"
                  onClick={() => setSection("advanced")}
                  type="button"
                  variant={section === "advanced" ? "secondary" : "ghost"}
                >
                  <Settings2Icon data-icon="inline-start" />
                  Advanced
                </Button>
              </nav>
            </aside>
            <main className="flex min-h-0 min-w-0 flex-col bg-background">
              <div className="border-b p-3 lg:hidden">
                <Select
                  onValueChange={(value) => setSection(value as BuilderSection)}
                  value={section}
                >
                  <SelectTrigger
                    aria-label="Builder section"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="overview">Overview</SelectItem>
                      <SelectItem value="apps">Apps</SelectItem>
                      <SelectItem value="commands">
                        Repository commands
                      </SelectItem>
                      <SelectItem value="ports">Ports & slots</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                {centerContent()}
              </ScrollArea>
              {error ? (
                <div className="border-t p-3">
                  <Alert variant="destructive">
                    <CircleAlertIcon />
                    <AlertTitle>Could not save configuration</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                </div>
              ) : null}
            </main>
          </div>
          <footer className="grid items-center gap-2 border-t px-5 py-3 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className="flex items-center gap-2 whitespace-nowrap">
              {validation.success ? <CheckCircle2Icon /> : <CircleAlertIcon />}{" "}
              {appEntries.length} {appEntries.length === 1 ? "app" : "apps"} ·{" "}
              {launchModeDescription(launchMode, "command")} ·{" "}
              {validation.success
                ? "Valid configuration"
                : `${validationIssues.length} ${validationIssues.length === 1 ? "issue" : "issues"}`}
            </span>
            {!validation.success && validationIssues[0] ? (
              <span className="truncate text-destructive">
                <code>{validationIssues[0].path.join(".") || "config"}</code> ·{" "}
                {validationIssues[0].message}
              </span>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground sm:text-right">
              Version 1
            </span>
          </footer>
        </form>
      </DialogContent>
      <AlertDialog
        onOpenChange={setDiscardConfirmationOpen}
        open={discardConfirmationOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your configuration draft has not been saved to .workgrove.json.
              Closing the builder will discard it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndClose} variant="destructive">
              Discard and close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
