import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import type { WorkgroveCommand } from "../../config/workgrove-command";
import {
  canonicalizeWorkgroveConfig,
  type WorkgroveApp,
  WorkgroveAppIdSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "../../config/workgrove-schema";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
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
              One executable or argument per row. Templates such as
              <code className="ml-1">{"{port}"}</code> are supported.
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
      onBlur={() => onRename(draft)}
      onChange={(event) => setDraft(event.target.value)}
      value={draft}
    />
  );
}

type LaunchMode = "aggregate" | "none" | "per-app";

function LaunchModeEditor({
  onChange,
  value,
}: {
  onChange: (value: LaunchMode) => void;
  value: LaunchMode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="config-launch-mode">Launch mode</FieldLabel>
      <Select
        onValueChange={(nextValue) => onChange(nextValue as LaunchMode)}
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

function AppEditor({
  app,
  appCount,
  appError,
  id,
  onDelete,
  onRename,
  showStartCommand,
  control,
}: {
  app: WorkgroveApp;
  appCount: number;
  appError: unknown;
  id: string;
  onDelete: () => void;
  onRename: (nextId: string) => string | undefined;
  showStartCommand: boolean;
  control: ReturnType<typeof useForm<WorkgroveConfig>>["control"];
}) {
  const offsetError = errorMessage(
    (appError as { offset?: unknown } | undefined)?.offset
  );
  const startError = errorMessage(
    (appError as { start?: unknown } | undefined)?.start
  );
  const idError = directErrorMessage(appError);
  const [renameError, setRenameError] = useState<string | undefined>();
  const displayedIdError = renameError ?? idError;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{app.control?.label || id}</CardTitle>
        <CardDescription>
          App identifier, port offset, runtime controls, and process command.
        </CardDescription>
        <CardAction>
          <Button
            aria-label={`Delete ${id}`}
            disabled={appCount === 1}
            onClick={onDelete}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={Boolean(displayedIdError)}>
            <FieldLabel>App identifier</FieldLabel>
            <AppIdInput
              id={id}
              invalid={Boolean(displayedIdError)}
              onRename={(nextId) => setRenameError(onRename(nextId))}
            />
            <FieldError>{displayedIdError}</FieldError>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
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
              name={`apps.${id}.offset`}
              render={({ field }) => (
                <Field data-invalid={Boolean(offsetError)}>
                  <FieldLabel htmlFor={`app-${id}-offset`}>
                    Port offset
                  </FieldLabel>
                  <Input
                    aria-invalid={Boolean(offsetError)}
                    id={`app-${id}-offset`}
                    min={0}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ""
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                    type="number"
                    value={Number.isNaN(field.value) ? "" : field.value}
                  />
                  <FieldError>{offsetError}</FieldError>
                </Field>
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
          {showStartCommand ? (
            <Controller
              control={control}
              name={`apps.${id}.start`}
              render={({ field }) => (
                <CommandEditor
                  description="Use per-app commands for independently managed processes."
                  error={startError}
                  id={`app-${id}-start`}
                  label="Start command"
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
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
  const form = useForm<WorkgroveConfig>({
    defaultValues: canonicalizeWorkgroveConfig(config),
    mode: "onChange",
    resolver: zodResolver(WorkgroveConfigSchema),
  });
  const apps = useWatch({ control: form.control, name: "apps" }) ?? {};
  const aggregateStart = useWatch({
    control: form.control,
    name: "control.start",
  });
  const appEntries = Object.entries(apps);
  const errors = form.formState.errors;
  let launchMode: LaunchMode = "none";
  if (aggregateStart) {
    launchMode = "aggregate";
  } else if (Object.values(apps).some((app) => app.start)) {
    launchMode = "per-app";
  }

  function changeLaunchMode(mode: LaunchMode): void {
    if (mode === "none") {
      form.setValue("control.start", undefined, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue(
        "apps",
        Object.fromEntries(
          Object.entries(apps).map(([id, app]) => [
            id,
            { ...app, start: undefined },
          ])
        ),
        { shouldDirty: true, shouldValidate: true }
      );
      return;
    }
    if (mode === "aggregate") {
      form.setValue(
        "apps",
        Object.fromEntries(
          Object.entries(apps).map(([id, app]) => [
            id,
            { ...app, start: undefined },
          ])
        ),
        { shouldDirty: true, shouldValidate: true }
      );
      form.setValue("control.start", aggregateStart ?? { argv: [""] }, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }
    form.setValue("control.start", undefined, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const requiredIds = Object.entries(apps)
      .filter(([, app]) => {
        const probe = app.control?.probe ?? "tcp";
        return probe === "tcp" && (app.control?.required ?? true);
      })
      .map(([id]) => id);
    const targets = new Set(
      requiredIds.length > 0 ? requiredIds : Object.keys(apps).slice(0, 1)
    );
    form.setValue(
      "apps",
      Object.fromEntries(
        Object.entries(apps).map(([id, app]) => [
          id,
          targets.has(id)
            ? { ...app, start: app.start ?? { argv: [""] } }
            : app,
        ])
      ),
      { shouldDirty: true, shouldValidate: true }
    );
  }

  function addApp(): void {
    let id = "app";
    let suffix = 2;
    while (Object.hasOwn(apps, id)) {
      id = `app${suffix}`;
      suffix += 1;
    }
    const usedOffsets = new Set(Object.values(apps).map((app) => app.offset));
    let offset = 0;
    while (usedOffsets.has(offset)) {
      offset += 1;
    }
    form.setValue(
      "apps",
      { ...apps, [id]: { offset } },
      { shouldDirty: true, shouldValidate: true }
    );
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
    const next = Object.fromEntries(
      Object.entries(apps).map(([appId, app]) => [
        appId === id ? nextId : appId,
        app,
      ])
    );
    form.clearErrors("apps");
    form.setValue("apps", next, { shouldDirty: true, shouldValidate: true });
    return undefined;
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
      <DialogContent className="flex h-[90vh] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b p-5 pr-12">
          <DialogTitle>Repository configuration</DialogTitle>
          <DialogDescription>
            Edit <code className="break-all">{configPath}</code>. Validation is
            shared with the Workgrove executable.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={form.handleSubmit((value) =>
            onSave(canonicalizeWorkgroveConfig(value))
          )}
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 p-5">
              <Alert>
                <InfoIcon />
                <AlertTitle>Commands are trusted repository code</AlertTitle>
                <AlertDescription>
                  Choose either one aggregate start command or per-app start
                  commands. Workgrove validates the complete configuration again
                  before writing it.
                </AlertDescription>
              </Alert>
              <Card>
                <CardHeader>
                  <CardTitle>Ports and slots</CardTitle>
                  <CardDescription>
                    Each app receives base + slot × stride + app offset.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Controller
                        control={form.control}
                        name="range.base"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="config-range-base">
                              Base port
                            </FieldLabel>
                            <Input
                              aria-invalid={fieldState.invalid}
                              id="config-range-base"
                              max={65_535}
                              min={1024}
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
                        name="range.stride"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="config-range-stride">
                              Slot stride
                            </FieldLabel>
                            <Input
                              aria-invalid={fieldState.invalid}
                              id="config-range-stride"
                              max={65_535}
                              min={1}
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
                            <FieldLabel htmlFor="config-slot-file">
                              Slot file
                            </FieldLabel>
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
                            <FieldLabel htmlFor="config-url">
                              App URL template
                            </FieldLabel>
                            <Input
                              aria-invalid={fieldState.invalid}
                              className="font-mono"
                              id="config-url"
                              {...field}
                            />
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />
                    </div>
                  </FieldGroup>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Repository commands</CardTitle>
                  <CardDescription>
                    Setup runs once per worktree. Aggregate start is mutually
                    exclusive with per-app starts.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <LaunchModeEditor
                      onChange={changeLaunchMode}
                      value={launchMode}
                    />
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
                            description="Start all apps in one managed process."
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
                </CardContent>
              </Card>
              <section className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="font-heading font-medium text-sm">Apps</h2>
                    <p className="text-muted-foreground text-xs/relaxed">
                      Define each independently addressable development service.
                    </p>
                  </div>
                  <Button onClick={addApp} type="button" variant="outline">
                    <PlusIcon data-icon="inline-start" />
                    Add app
                  </Button>
                </div>
                {appEntries.map(([id, app]) => (
                  <AppEditor
                    app={app}
                    appCount={appEntries.length}
                    appError={errors.apps?.[id]}
                    control={form.control}
                    id={id}
                    key={id}
                    onDelete={() =>
                      form.setValue(
                        "apps",
                        Object.fromEntries(
                          appEntries.filter(([appId]) => appId !== id)
                        ),
                        { shouldDirty: true, shouldValidate: true }
                      )
                    }
                    onRename={(nextId) => renameApp(id, nextId)}
                    showStartCommand={launchMode === "per-app"}
                  />
                ))}
                <FieldError>{directErrorMessage(errors.apps)}</FieldError>
              </section>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not save configuration</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 border-t p-4">
            <Button
              disabled={pending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={pending || !form.formState.isDirty} type="submit">
              {pending ? "Saving…" : "Save configuration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
