import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";
import { workgroveTemplateError } from "./workgrove-template";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;
export const WORKGROVE_DEFAULT_SLOT = 0;
export const WORKGROVE_SLOT_ENV = "WORKGROVE_SLOT";
export const WORKGROVE_SLOT_FILE = ".env.worktree.local";
export const WORKGROVE_DEFAULT_STRIDE = 10;

const APP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const WorkgroveAppIdSchema = z.string().regex(APP_ID_PATTERN);
export const WorkgroveEnvironmentNameSchema = z
  .string()
  .regex(ENVIRONMENT_NAME_PATTERN)
  .refine((name) => name !== WORKGROVE_SLOT_ENV, {
    message: `${WORKGROVE_SLOT_ENV} is managed by Workgrove`,
  });

export const WorkgroveAppSchema = z.strictObject({
  basePort: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
});

export type WorkgroveApp = z.infer<typeof WorkgroveAppSchema>;

const WorkgroveConfigObjectSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  stride: z
    .number()
    .int()
    .min(1)
    .max(MAX_WORKGROVE_PORT)
    .default(WORKGROVE_DEFAULT_STRIDE),
  setup: WorkgroveCommandSchema.optional(),
  start: WorkgroveCommandSchema.optional(),
  apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
  env: z.record(WorkgroveEnvironmentNameSchema, z.string()).optional(),
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
  const basePorts = new Map<number, string>();
  for (const [id, app] of apps) {
    const existing = basePorts.get(app.basePort);
    if (existing) {
      context.addIssue({
        code: "custom",
        message: `Base port is already assigned to ${existing}`,
        path: ["apps", id, "basePort"],
      });
    } else {
      basePorts.set(app.basePort, id);
    }
  }
  const appIds = new Set(apps.map(([id]) => id));
  for (const [name, template] of Object.entries(config.env ?? {})) {
    const error = workgroveTemplateError(template, appIds);
    if (error) {
      context.addIssue({ code: "custom", message: error, path: ["env", name] });
    }
  }
}

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

export function resolveWorkgroveAppPort(
  app: Pick<WorkgroveApp, "basePort">,
  slot: number,
  stride: number
): number {
  return app.basePort + slot * stride;
}

export function maximumWorkgroveSlot(
  config: Pick<WorkgroveConfig, "apps" | "stride">
): number {
  return Math.min(
    ...Object.values(config.apps).map((app) =>
      Math.floor((MAX_WORKGROVE_PORT - app.basePort) / config.stride)
    )
  );
}

export function workgroveSlotsHavePortCollision(
  config: Pick<WorkgroveConfig, "apps" | "stride">,
  leftSlot: number,
  rightSlot: number
): boolean {
  const leftPorts = new Set(
    Object.values(config.apps).map((app) =>
      resolveWorkgroveAppPort(app, leftSlot, config.stride)
    )
  );
  return Object.values(config.apps).some((app) =>
    leftPorts.has(resolveWorkgroveAppPort(app, rightSlot, config.stride))
  );
}

export function cloneWorkgroveConfig(config: WorkgroveConfig): WorkgroveConfig {
  return structuredClone(config);
}
