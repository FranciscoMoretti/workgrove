import { zodResolver } from "@hookform/resolvers/zod";
import {
  AppWindowIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  HomeIcon,
  InfoIcon,
  NetworkIcon,
  PlusIcon,
  Settings2Icon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Card,
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
  FieldLegend,
  FieldSet,
} from "./ui/field";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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

  function updateArgument(index: number, argument: string): void {
    const argv = [...command.argv];
    argv[index] = argument;
    onChange({ ...command, argv });
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">{label}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <Field orientation="horizontal">
        <Checkbox
          checked={enabled}
          id={`${id}-enabled`}
          onCheckedChange={(checked) =>
            onChange(checked === true ? command : undefined)
          }
        />
        <FieldLabel htmlFor={`${id}-enabled`}>Enabled</FieldLabel>
      </Field>
      {enabled ? (
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel>Arguments</FieldLabel>
            <FieldDescription>
              One executable or argument per row. Supports {"{port}"},{" "}
              {"{slot}"}, {"{url}"}, and cross-app templates such as{" "}
              <code>{"{apps.api.url}"}</code>.
            </FieldDescription>
            {command.argv.map((argument, index) => (
              <div
                className="flex items-center gap-2"
                // biome-ignore lint/suspicious/noArrayIndexKey: argv is an ordered string array with no stable row identifier.
                key={`${id}-arg-${index}`}
              >
                <Input
                  aria-invalid={Boolean(error)}
                  aria-label={`Argument ${index + 1}`}
                  className="font-mono"
                  onChange={(event) =>
                    updateArgument(index, event.target.value)
                  }
                  value={argument}
                />
                <Button
                  aria-label={`Remove argument ${index + 1}`}
                  disabled={command.argv.length === 1}
                  onClick={() =>
                    onChange({
                      ...command,
                      argv: command.argv.filter(
                        (_, argumentIndex) => argumentIndex !== index
                      ),
                    })
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              onClick={() =>
                onChange({ ...command, argv: [...command.argv, ""] })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon data-icon="inline-start" />
              Add argument
            </Button>
            <FieldError>{error}</FieldError>
          </Field>
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
          </Field>
          <Field>
            <FieldLabel>Command environment</FieldLabel>
            <KeyValueEditor
              addLabel="Add variable"
              id={`${id}-environment`}
              onChange={(env) => onChange({ ...command, env })}
              value={command.env}
            />
          </Field>
        </FieldGroup>
      ) : null}
    </FieldSet>
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
      <FieldDescription>
        Slot 0 uses {numericValue}; every next slot adds {ports.slotStride}.
      </FieldDescription>
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
  const form = useForm<WorkgroveConfig>({
    defaultValues: canonicalizeWorkgroveConfig(config),
    mode: "onChange",
    resolver: zodResolver(WorkgroveConfigSchema),
  });
  const [section, setSection] = useState<BuilderSection>("overview");
  const [selectedAppId, setSelectedAppId] = useState(
    () => Object.keys(config.apps)[0] ?? ""
  );
  const apps = useWatch({ control: form.control, name: "apps" }) ?? {};
  const appEntries = Object.entries(apps);
  const errors = form.formState.errors;
  const launchMode = workgroveLaunchMode({
    apps,
    control: form.getValues("control"),
  });

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

  const draft = useWatch({ control: form.control });
  const validation = WorkgroveConfigSchema.safeParse(draft);
  const validationIssues = validation.success ? [] : validation.error.issues;
  const selectedApp = apps[selectedAppId] ?? appEntries[0]?.[1];
  const effectiveSelectedAppId = apps[selectedAppId]
    ? selectedAppId
    : (appEntries[0]?.[0] ?? "");
  const stride = draft.ports?.slotStride ?? 0;
  const previewSlots = [0, 1, 2];

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
    form.reset(canonicalizeWorkgroveConfig(config));
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
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="h-[calc(100vh-1rem)] max-w-[calc(100%-1rem)] gap-0 p-0 sm:max-w-[calc(100%-1rem)]">
        <form
          className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
          onSubmit={form.handleSubmit((value) =>
            onSave(canonicalizeWorkgroveConfig(value))
          )}
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
                disabled={pending || !form.formState.isDirty}
                onClick={resetChanges}
                type="button"
                variant="outline"
              >
                Discard changes
              </Button>
              <Button
                disabled={
                  pending || !form.formState.isDirty || !validation.success
                }
                type="submit"
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </div>
          </header>
          <div className="grid min-h-0 min-w-0 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
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
              <div className="flex flex-col gap-2 border-t bg-muted/10 p-3 text-xs xl:hidden">
                <div className="flex items-center justify-between gap-3">
                  <strong>Live slot preview</strong>
                  <span
                    className={
                      validation.success
                        ? "text-muted-foreground"
                        : "text-destructive"
                    }
                  >
                    {validation.success
                      ? "Valid configuration"
                      : `${validationIssues.length} ${validationIssues.length === 1 ? "issue" : "issues"}`}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {previewSlots.flatMap((slot) =>
                    appEntries.map(([id, app]) => (
                      <span
                        className="shrink-0 rounded-md border bg-background px-2 py-1"
                        key={`compact:${slot}:${id}`}
                      >
                        Slot {slot} · {app.control?.label || id}{" "}
                        <code>{previewPort(app, slot)}</code>
                      </span>
                    ))
                  )}
                </div>
                {!validation.success && validationIssues[0] ? (
                  <p className="text-destructive">
                    <code>
                      {validationIssues[0].path.join(".") || "config"}
                    </code>{" "}
                    · {validationIssues[0].message}
                  </p>
                ) : null}
              </div>
            </main>
            <aside className="min-h-0 border-l bg-muted/10 max-xl:hidden">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 p-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Slot preview</CardTitle>
                      <CardDescription>
                        Computed from unsaved values.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {previewSlots.map((slot) => (
                        <section
                          className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                          key={slot}
                        >
                          <strong>
                            Slot {slot}
                            {slot === draft.slot?.default ? " · default" : ""}
                          </strong>
                          {appEntries.map(([id, app]) => (
                            <div
                              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs"
                              key={`${slot}:${id}`}
                            >
                              <span className="truncate">
                                {app.control?.label || id}
                              </span>
                              <span className="flex items-center gap-2">
                                <code>{previewPort(app, slot)}</code>
                                <ExternalLinkIcon />
                              </span>
                              <code className="col-span-2 truncate text-muted-foreground">
                                {previewUrl(app, slot)}
                              </code>
                            </div>
                          ))}
                        </section>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Validation</CardTitle>
                      <CardDescription>
                        The shared Zod schema validates this draft.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {validation.success ? (
                        <div className="flex items-start gap-2">
                          <CheckCircle2Icon />
                          <div>
                            <strong>No issues found</strong>
                            <p className="text-muted-foreground">
                              This configuration is valid.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-2 text-destructive">
                            <CircleAlertIcon />
                            <strong>
                              {validationIssues.length} validation{" "}
                              {validationIssues.length === 1
                                ? "issue"
                                : "issues"}
                            </strong>
                          </div>
                          {validationIssues.slice(0, 5).map((issue) => (
                            <p
                              className="text-xs"
                              key={`${issue.path.join(".")}:${issue.message}`}
                            >
                              <code>{issue.path.join(".") || "config"}</code> ·{" "}
                              {issue.message}
                            </p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  {error ? (
                    <Alert variant="destructive">
                      <CircleAlertIcon />
                      <AlertTitle>Could not save configuration</AlertTitle>
                      <AlertDescription>{error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              </ScrollArea>
            </aside>
          </div>
          <footer className="flex items-center justify-between gap-4 border-t px-5 py-3 text-xs">
            <span className="flex items-center gap-2">
              {validation.success ? <CheckCircle2Icon /> : <CircleAlertIcon />}{" "}
              {appEntries.length} {appEntries.length === 1 ? "app" : "apps"} ·{" "}
              {launchModeDescription(launchMode, "command")} ·{" "}
              {validation.success
                ? "Valid configuration"
                : `${validationIssues.length} ${validationIssues.length === 1 ? "issue" : "issues"}`}
            </span>
            <span className="text-muted-foreground">Version 1</span>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
