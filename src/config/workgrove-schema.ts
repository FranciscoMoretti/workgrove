import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;
export const WORKGROVE_DEFAULT_SLOT = 0;
export const WORKGROVE_SLOT_ENV = "WORKGROVE_SLOT";
export const WORKGROVE_SLOT_FILE = ".env.worktree.local";
export const WORKGROVE_SLOT_STRIDE = 10;

const APP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const WorkgroveAppIdSchema = z.string().regex(APP_ID_PATTERN);

export const WorkgroveAppSchema = z.strictObject({
  basePort: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
});

export type WorkgroveApp = z.infer<typeof WorkgroveAppSchema>;

const WorkgroveConfigObjectSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  setup: WorkgroveCommandSchema.optional(),
  start: WorkgroveCommandSchema.optional(),
  apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
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
  const environmentNames = new Map<string, string>();
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
    const environmentName = workgroveAppPortEnvironmentName(id);
    const existingEnvironment = environmentNames.get(environmentName);
    if (existingEnvironment) {
      context.addIssue({
        code: "custom",
        message: `App port environment variable is already assigned to ${existingEnvironment}`,
        path: ["apps", id],
      });
    } else {
      environmentNames.set(environmentName, id);
    }
  }
}

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

export function workgroveAppPortEnvironmentName(appId: string): string {
  return `WORKGROVE_${appId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PORT`;
}

export function resolveWorkgroveAppPort(
  app: Pick<WorkgroveApp, "basePort">,
  slot: number
): number {
  return app.basePort + slot * WORKGROVE_SLOT_STRIDE;
}

export function maximumWorkgroveSlot(
  config: Pick<WorkgroveConfig, "apps">
): number {
  return Math.min(
    ...Object.values(config.apps).map((app) =>
      Math.floor((MAX_WORKGROVE_PORT - app.basePort) / WORKGROVE_SLOT_STRIDE)
    )
  );
}

export function workgroveSlotsHavePortCollision(
  config: Pick<WorkgroveConfig, "apps">,
  leftSlot: number,
  rightSlot: number
): boolean {
  const leftPorts = new Set(
    Object.values(config.apps).map((app) =>
      resolveWorkgroveAppPort(app, leftSlot)
    )
  );
  return Object.values(config.apps).some((app) =>
    leftPorts.has(resolveWorkgroveAppPort(app, rightSlot))
  );
}

export function cloneWorkgroveConfig(config: WorkgroveConfig): WorkgroveConfig {
  return structuredClone(config);
}
