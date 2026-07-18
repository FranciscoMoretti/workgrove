import {
  ArrowLeftIcon,
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
  renameWorkgroveAppGroup,
  renameWorkgroveEnvironment,
  resolveWorkgroveAppEndpoints,
} from "../../config/workgrove-editor";
import {
  cloneWorkgroveConfig,
  WorkgroveAppGroupNameSchema,
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
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Separator } from "./ui/separator";
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

function CommandField({
  command,
  id,
  label,
  onChange,
  placeholder,
}: {
  command: WorkgroveCommand;
  id: string;
  label: string;
  onChange: (command: WorkgroveCommand) => void;
  placeholder: string;
}) {
  const externalValue = editableCommandLine(command.argv);
  const [draft, setDraft] = useState(externalValue);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(externalValue);
  useEffect(() => {
    if (externalValue !== submitted.current) {
      setDraft(externalValue);
    }
    submitted.current = externalValue;
  }, [externalValue]);
  function update(value: string, normalize: boolean) {
    setDraft(value);
    try {
      const argv = parseCommandLine(value);
      if (argv.length === 0) {
        throw new Error("Enter a command to run");
      }
      const formatted = formatCommandLine(argv);
      submitted.current = formatted;
      setError(null);
      if (normalize) {
        setDraft(formatted);
      }
      onChange({ argv });
    } catch (caught) {
      submitted.current = "";
      setError(
        caught instanceof Error ? caught.message : "Enter a valid command"
      );
      onChange({ argv: [] });
    }
  }
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <TerminalSquareIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-invalid={Boolean(error)}
          id={id}
          onBlur={() => update(draft, true)}
          onChange={(event) => update(event.target.value, false)}
          placeholder={placeholder}
          value={draft}
        />
      </InputGroup>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function EditableName({
  ariaLabel,
  name,
  onRename,
}: {
  ariaLabel: string;
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
        aria-label={ariaLabel}
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

function heading(title: string, description: string) {
  return (
    <div className="space-y-1">
      <h2 className="font-medium text-base">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

export function RepositoryConfigPage({
  config,
  configPath,
  error,
  navigationRequest,
  onClose,
  onDirtyChange,
  onSave,
  pending,
}: {
  config: WorkgroveConfig;
  configPath: string;
  error: Error | null;
  navigationRequest: number;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (value: WorkgroveConfig) => Promise<void>;
  pending: boolean;
}) {
  const [sourceConfig] = useState(() => cloneWorkgroveConfig(config));
  const [draft, setDraft] = useState<WorkgroveConfig>(
    () => loadConfigDraft(configPath, sourceConfig) ?? sourceConfig
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(sourceConfig);
  const validation = WorkgroveConfigSchema.safeParse(draft);

  useEffect(() => {
    if (isDirty) {
      saveConfigDraft(configPath, sourceConfig, draft);
    } else {
      clearConfigDraft(configPath);
    }
  }, [configPath, draft, isDirty, sourceConfig]);
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (navigationRequest > 0) {
      setDiscardOpen(true);
    }
  }, [navigationRequest]);
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [isDirty]);

  function requestClose() {
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  }
  function renameGroup(name: string, next: string): string | null {
    if (name === next) {
      return null;
    }
    if (!WorkgroveAppGroupNameSchema.safeParse(next).success) {
      return "Enter a group name";
    }
    if (Object.hasOwn(draft.appGroups, next)) {
      return `${next} already exists`;
    }
    setDraft((current) => renameWorkgroveAppGroup(current, name, next));
    return null;
  }
  function addGroup() {
    let name = "New App Group";
    let suffix = 2;
    while (Object.hasOwn(draft.appGroups, name)) {
      name = `New App Group ${suffix++}`;
    }
    setDraft((current) => ({
      ...current,
      appGroups: {
        ...current.appGroups,
        [name]: {
          slot: { default: 0, stride: 10 },
          start: { argv: [""] },
          stop: "process",
          apps: { App: { basePort: 3000 } },
        },
      },
    }));
  }
  function updateGroup(
    name: string,
    update: (
      group: WorkgroveConfig["appGroups"][string]
    ) => WorkgroveConfig["appGroups"][string]
  ) {
    setDraft((current) => ({
      ...current,
      appGroups: {
        ...current.appGroups,
        [name]: update(current.appGroups[name]),
      },
    }));
  }
  function renameApp(
    groupName: string,
    name: string,
    next: string
  ): string | null {
    if (name === next) {
      return null;
    }
    if (!WorkgroveAppIdSchema.safeParse(next).success) {
      return "Enter an app name";
    }
    if (Object.hasOwn(draft.appGroups[groupName].apps, next)) {
      return `${next} already exists`;
    }
    setDraft((current) => renameWorkgroveApp(current, groupName, name, next));
    return null;
  }
  function renameEnvironment(name: string, next: string): string | null {
    if (name === next) {
      return null;
    }
    if (!WorkgroveEnvironmentNameSchema.safeParse(next).success) {
      return "Use a valid environment variable name";
    }
    if (Object.hasOwn(draft.env ?? {}, next)) {
      return `${next} already exists`;
    }
    setDraft((current) => renameWorkgroveEnvironment(current, name, next));
    return null;
  }
  async function save() {
    if (!validation.success) {
      return;
    }
    await onSave(validation.data);
    clearConfigDraft(configPath);
  }
  const issues = validation.success ? [] : validation.error.issues;

  return (
    <main className="flex h-screen min-w-0 flex-col bg-background">
      <header className="shrink-0 border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-6 py-5">
          <Button
            aria-label="Back to worktrees"
            onClick={requestClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="font-heading font-medium text-xl">
              Repository settings
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure independently managed App groups and their endpoints.
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-6 py-8">
          <section className="space-y-4">
            {heading("Setup", "This finite command prepares each worktree.")}
            <CommandField
              command={draft.setup}
              id="repository-setup"
              label="Command"
              onChange={(setup) =>
                setDraft((current) => ({ ...current, setup }))
              }
              placeholder="bun install"
            />
          </section>
          <Separator />
          <section className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              {heading(
                "App groups",
                "Each group has independent lifecycle, slot allocation, and observed endpoints."
              )}
              <Button onClick={addGroup} variant="outline">
                <PlusIcon />
                Add group
              </Button>
            </div>
            {Object.entries(draft.appGroups).map(([groupName, group]) => {
              const endpoints = resolveWorkgroveAppEndpoints(
                draft,
                groupName,
                group.slot.default
              );
              return (
                <div
                  className="space-y-5 rounded-lg border p-5"
                  key={groupName}
                >
                  <div className="flex items-start gap-3">
                    <div className="max-w-md flex-1">
                      <EditableName
                        ariaLabel={`App group name ${groupName}`}
                        name={groupName}
                        onRename={(next) => renameGroup(groupName, next)}
                      />
                    </div>
                    <Button
                      aria-label={`Delete ${groupName}`}
                      disabled={Object.keys(draft.appGroups).length === 1}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          appGroups: Object.fromEntries(
                            Object.entries(current.appGroups).filter(
                              ([name]) => name !== groupName
                            )
                          ),
                        }))
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <CommandField
                      command={group.start}
                      id={`${groupName}-start`}
                      label="Start command"
                      onChange={(start) =>
                        updateGroup(groupName, (current) => ({
                          ...current,
                          start,
                        }))
                      }
                      placeholder="bun dev"
                    />
                    <Field>
                      <FieldLabel htmlFor={`${groupName}-stop-mode`}>
                        Stop
                      </FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          updateGroup(groupName, (current) => ({
                            ...current,
                            stop:
                              value === "process" ? "process" : { argv: [""] },
                          }))
                        }
                        value={group.stop === "process" ? "process" : "command"}
                      >
                        <SelectTrigger id={`${groupName}-stop-mode`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="process">
                            Stop the process
                          </SelectItem>
                          <SelectItem value="command">Run a command</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-xs">
                        Process is for a foreground Start command. Command is
                        for services shared by slot.
                      </p>
                    </Field>
                    {group.stop === "process" ? null : (
                      <CommandField
                        command={group.stop}
                        id={`${groupName}-stop-command`}
                        label="Stop command"
                        onChange={(stop) =>
                          updateGroup(groupName, (current) => ({
                            ...current,
                            stop,
                          }))
                        }
                        placeholder="docker compose down"
                      />
                    )}
                    <Field>
                      <FieldLabel>Default slot</FieldLabel>
                      <Input
                        min={0}
                        onChange={(event) =>
                          updateGroup(groupName, (current) => ({
                            ...current,
                            slot: {
                              ...current.slot,
                              default:
                                event.target.value === ""
                                  ? Number.NaN
                                  : Number(event.target.value),
                            },
                          }))
                        }
                        type="number"
                        value={
                          Number.isNaN(group.slot.default)
                            ? ""
                            : group.slot.default
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Slot stride</FieldLabel>
                      <Input
                        min={1}
                        onChange={(event) =>
                          updateGroup(groupName, (current) => ({
                            ...current,
                            slot: {
                              ...current.slot,
                              stride:
                                event.target.value === ""
                                  ? Number.NaN
                                  : Number(event.target.value),
                            },
                          }))
                        }
                        type="number"
                        value={
                          Number.isNaN(group.slot.stride)
                            ? ""
                            : group.slot.stride
                        }
                      />
                    </Field>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>App name</TableHead>
                        <TableHead>Base port</TableHead>
                        <TableHead>Default-slot endpoint</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(group.apps).map(([appName, app]) => (
                        <TableRow key={appName}>
                          <TableCell>
                            <EditableName
                              ariaLabel={`App name ${appName}`}
                              name={appName}
                              onRename={(next) =>
                                renameApp(groupName, appName, next)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={`Base port for ${appName}`}
                              min={1024}
                              onChange={(event) =>
                                updateGroup(groupName, (current) => ({
                                  ...current,
                                  apps: {
                                    ...current.apps,
                                    [appName]: {
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
                          <TableCell>
                            <code>
                              {endpoints[appName]?.url ?? "Invalid port"}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Button
                              aria-label={`Delete ${appName}`}
                              disabled={Object.keys(group.apps).length === 1}
                              onClick={() =>
                                updateGroup(groupName, (current) => ({
                                  ...current,
                                  apps: Object.fromEntries(
                                    Object.entries(current.apps).filter(
                                      ([name]) => name !== appName
                                    )
                                  ),
                                }))
                              }
                              size="icon"
                              variant="ghost"
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Button
                    onClick={() =>
                      updateGroup(groupName, (current) => {
                        let name = "App";
                        let suffix = 2;
                        while (Object.hasOwn(current.apps, name)) {
                          name = `App ${suffix++}`;
                        }
                        return {
                          ...current,
                          apps: {
                            ...current.apps,
                            [name]: {
                              basePort: nextAvailableWorkgroveAppBasePort(
                                current.apps
                              ),
                            },
                          },
                        };
                      })
                    }
                    variant="outline"
                  >
                    <PlusIcon />
                    Add app
                  </Button>
                </div>
              );
            })}
          </section>
          <Separator />
          <section className="space-y-5">
            {heading(
              "Environment",
              "Use exact tokens such as {appGroups.Product Apps.apps.Web.port} or {appGroups.Infrastructure.slot}."
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(draft.env ?? {}).map(([name, value]) => (
                  <TableRow key={name}>
                    <TableCell>
                      <EditableName
                        ariaLabel={`Environment variable ${name}`}
                        name={name}
                        onRename={(next) => renameEnvironment(name, next)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Value for ${name}`}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            env: { ...current.env, [name]: event.target.value },
                          }))
                        }
                        value={value}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        aria-label={`Delete ${name}`}
                        onClick={() =>
                          setDraft((current) =>
                            deleteWorkgroveEnvironment(current, name)
                          )
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              onClick={() => setDraft(addWorkgroveEnvironment)}
              variant="outline"
            >
              <PlusIcon />
              Add variable
            </Button>
          </section>
          {issues.length ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Configuration needs attention</AlertTitle>
              <AlertDescription>
                {issues.slice(0, 4).map((issue) => (
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
      <footer className="shrink-0 border-t bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-6 py-4">
          {discardOpen ? (
            <>
              <p className="mr-auto text-muted-foreground">
                Discard unsaved configuration changes?
              </p>
              <Button onClick={() => setDiscardOpen(false)} variant="outline">
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  clearConfigDraft(configPath);
                  onClose();
                }}
                variant="destructive"
              >
                Discard changes
              </Button>
            </>
          ) : (
            <>
              <Button onClick={requestClose} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={!(isDirty && validation.success) || pending}
                onClick={save}
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
