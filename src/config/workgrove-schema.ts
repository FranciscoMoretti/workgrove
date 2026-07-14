import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";
import {
  workgroveTemplateTokenAppReference,
  workgroveTemplateTokens,
} from "./workgrove-template";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;

const APP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const WorkgroveAppIdSchema = z.string().regex(APP_ID_PATTERN);

export const WorkgroveAppPortSchema = z.union([
  z.strictObject({
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({
    base: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
  }),
]);

export type WorkgroveAppPort = z.infer<typeof WorkgroveAppPortSchema>;

export const WorkgroveAppSchema = z.object({
  control: z
    .object({
      label: z.string().min(1).optional(),
      open: z.boolean().optional(),
      probe: z.enum(["none", "tcp"]).optional(),
      required: z.boolean().optional(),
    })
    .optional(),
  exports: z.record(z.string(), z.string()).optional(),
  port: WorkgroveAppPortSchema,
  start: WorkgroveCommandSchema.optional(),
});

export type WorkgroveApp = z.infer<typeof WorkgroveAppSchema>;

const WorkgroveControlSchema = z
  .object({
    postCreate: WorkgroveCommandSchema.optional(),
    setup: WorkgroveCommandSchema.optional(),
    start: WorkgroveCommandSchema.optional(),
  })
  .refine((control) => !(control.setup && control.postCreate), {
    message: "Configure control.setup or legacy control.postCreate, not both",
    path: ["setup"],
  });

const WorkgroveConfigObjectSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
  control: WorkgroveControlSchema.optional(),
  ports: z.object({
    base: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
    slotStride: z.number().int().positive().max(MAX_WORKGROVE_PORT),
  }),
  slot: z.object({
    default: z.number().int().nonnegative(),
    env: z.string().regex(ENVIRONMENT_NAME_PATTERN),
    file: z.string().min(1).optional(),
  }),
  url: z.string().min(1),
});

type WorkgroveConfigShape = z.infer<typeof WorkgroveConfigObjectSchema>;

export const WorkgroveConfigSchema = WorkgroveConfigObjectSchema.superRefine(
  validateWorkgroveConfig
);

function validateWorkgroveConfig(
  config: WorkgroveConfigShape,
  context: z.RefinementCtx
): void {
  const apps = Object.entries(config.apps);
  if (apps.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Workgrove config requires at least one app",
      path: ["apps"],
    });
    return;
  }
  validateWorkgroveLaunchCommands(config, context);
  validateWorkgrovePorts(config, context);
  validateWorkgroveTemplateReferences(config, context);
}

function validateWorkgroveLaunchCommands(
  config: WorkgroveConfigShape,
  context: z.RefinementCtx
): void {
  const apps = Object.entries(config.apps);
  const perAppEntries = apps.filter(([, app]) => app.start !== undefined);
  if (perAppEntries.length > 0 && config.control?.start) {
    context.addIssue({
      code: "custom",
      message:
        "Configure either per-app start commands or control.start, not both",
      path: ["control", "start"],
    });
  }
  if (perAppEntries.length === 0) {
    return;
  }
  for (const [id, app] of apps) {
    const probe = app.control?.probe ?? "tcp";
    const required = app.control?.required ?? probe === "tcp";
    if (probe === "tcp" && required && !app.start) {
      context.addIssue({
        code: "custom",
        message: "Required apps need start commands in per-app mode",
        path: ["apps", id, "start"],
      });
    }
  }
}

function validateWorkgrovePorts(
  config: WorkgroveConfigShape,
  context: z.RefinementCtx
): void {
  const portLanes = new Map<number, string>();
  for (const [id, app] of Object.entries(config.apps)) {
    if ("offset" in app.port && app.port.offset >= config.ports.slotStride) {
      context.addIssue({
        code: "custom",
        message: "Offset must be below the slot stride",
        path: ["apps", id, "port", "offset"],
      });
    }
    const slotZeroPort = resolveWorkgroveAppPort(config, app, 0);
    const lane = workgrovePortLane(slotZeroPort, config.ports.slotStride);
    const existing = portLanes.get(lane);
    if (existing) {
      context.addIssue({
        code: "custom",
        message: `Port lane collides with ${existing} in another worktree slot`,
        path: ["apps", id, "port"],
      });
    } else {
      portLanes.set(lane, id);
    }
    const port = resolveWorkgroveAppPort(config, app, config.slot.default);
    if (port > MAX_WORKGROVE_PORT) {
      context.addIssue({
        code: "custom",
        message: `Default slot computes invalid port ${port}`,
        path: ["apps", id, "port"],
      });
    }
  }
}

function validateWorkgroveTemplateReferences(
  config: WorkgroveConfigShape,
  context: z.RefinementCtx
): void {
  for (const { path, value } of workgroveTemplateValues(config)) {
    const isUrlTemplate = path.length === 1 && path[0] === "url";
    for (const token of workgroveTemplateTokens(value)) {
      const message = workgroveTemplateTokenError(config, token, isUrlTemplate);
      if (!message) {
        continue;
      }
      context.addIssue({ code: "custom", message, path });
    }
  }
}

function workgroveTemplateTokenError(
  config: WorkgroveConfigShape,
  token: string,
  isUrlTemplate: boolean
): string | null {
  if (token === "port" || token === "slot") {
    return null;
  }
  if (!isUrlTemplate && token === "url") {
    return null;
  }
  const appId = isUrlTemplate
    ? null
    : workgroveTemplateTokenAppReference(token);
  if (appId && Object.hasOwn(config.apps, appId)) {
    return null;
  }
  return appId
    ? `Template references unknown app ${appId}`
    : `Template variable {${token}} is not available here`;
}

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

function workgroveAppSlotZeroPort(
  ports: WorkgroveConfig["ports"],
  allocation: WorkgroveAppPort
): number {
  return "base" in allocation
    ? allocation.base
    : ports.base + allocation.offset;
}

function workgrovePortLane(port: number, stride: number): number {
  return ((port % stride) + stride) % stride;
}

function workgroveTemplateValues(
  config: WorkgroveConfigShape
): Array<{ path: (number | string)[]; value: string }> {
  const values: Array<{ path: (number | string)[]; value: string }> = [
    { path: ["url"], value: config.url },
  ];
  for (const [id, app] of Object.entries(config.apps)) {
    for (const [name, value] of Object.entries(app.exports ?? {})) {
      values.push({ path: ["apps", id, "exports", name], value });
    }
    appendCommandTemplateValues(values, ["apps", id, "start"], app.start);
  }
  appendCommandTemplateValues(
    values,
    ["control", "setup"],
    config.control?.setup
  );
  appendCommandTemplateValues(
    values,
    ["control", "start"],
    config.control?.start
  );
  return values;
}

function appendCommandTemplateValues(
  values: Array<{ path: (number | string)[]; value: string }>,
  path: (number | string)[],
  command: WorkgroveApp["start"]
): void {
  if (!command) {
    return;
  }
  command.argv.forEach((value, index) => {
    values.push({ path: [...path, "argv", index], value });
  });
  if (command.cwd) {
    values.push({ path: [...path, "cwd"], value: command.cwd });
  }
  for (const [name, value] of Object.entries(command.env ?? {})) {
    values.push({ path: [...path, "env", name], value });
  }
}

export function resolveWorkgroveAppPort(
  config: Pick<WorkgroveConfig, "ports">,
  app: Pick<WorkgroveApp, "port">,
  slot: number
): number {
  return (
    workgroveAppSlotZeroPort(config.ports, app.port) +
    slot * config.ports.slotStride
  );
}

export function maximumWorkgroveSlot(
  config: Pick<WorkgroveConfig, "apps" | "ports">
): number {
  return Math.min(
    ...Object.values(config.apps).map((app) =>
      Math.floor(
        (MAX_WORKGROVE_PORT -
          workgroveAppSlotZeroPort(config.ports, app.port)) /
          config.ports.slotStride
      )
    )
  );
}

export function canonicalizeWorkgroveConfig(
  config: WorkgroveConfig
): WorkgroveConfig {
  const next = structuredClone(config);
  if (next.control?.postCreate) {
    next.control.setup ??= next.control.postCreate;
    next.control.postCreate = undefined;
  }
  if (
    next.control &&
    !(next.control.setup || next.control.start || next.control.postCreate)
  ) {
    next.control = undefined;
  }
  for (const app of Object.values(next.apps)) {
    if (app.control) {
      app.control = Object.fromEntries(
        Object.entries(app.control).filter(([, value]) => value !== undefined)
      );
      if (Object.keys(app.control).length === 0) {
        app.control = undefined;
      }
    }
    if (app.exports && Object.keys(app.exports).length === 0) {
      app.exports = undefined;
    }
    if (app.start?.env && Object.keys(app.start.env).length === 0) {
      app.start.env = undefined;
    }
  }
  if (
    next.control?.setup?.env &&
    Object.keys(next.control.setup.env).length === 0
  ) {
    next.control.setup.env = undefined;
  }
  if (
    next.control?.start?.env &&
    Object.keys(next.control.start.env).length === 0
  ) {
    next.control.start.env = undefined;
  }
  return next;
}
