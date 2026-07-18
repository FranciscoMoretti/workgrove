import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";
import { workgroveTemplateError } from "./workgrove-template";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;
export const WORKGROVE_DEFAULT_SLOT = 0;
export const WORKGROVE_SLOTS_FILE = ".workgrove.local.json";
export const WORKGROVE_LEGACY_SLOT_ENV = "WORKGROVE_SLOT";
export const WORKGROVE_LEGACY_SLOT_FILE = ".env.worktree.local";
export const WORKGROVE_DEFAULT_STRIDE = 10;

export const WorkgroveAppGroupNameSchema = z.string().min(1);
export const WorkgroveAppIdSchema = z.string().min(1);
export const WorkgroveEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const WorkgroveAppSchema = z.strictObject({
  basePort: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
});

export type WorkgroveApp = z.infer<typeof WorkgroveAppSchema>;

export const WorkgroveAppGroupStopSchema = z.union([
  z.literal("process"),
  WorkgroveCommandSchema,
]);

export const WorkgroveAppGroupSchema = z.strictObject({
  slot: z.strictObject({
    default: z.number().int().nonnegative().default(WORKGROVE_DEFAULT_SLOT),
    stride: z
      .number()
      .int()
      .min(1)
      .max(MAX_WORKGROVE_PORT)
      .default(WORKGROVE_DEFAULT_STRIDE),
  }),
  start: WorkgroveCommandSchema,
  stop: WorkgroveAppGroupStopSchema,
  apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
});

export type WorkgroveAppGroup = z.infer<typeof WorkgroveAppGroupSchema>;

const WorkgroveConfigObjectSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(2),
  setup: WorkgroveCommandSchema,
  appGroups: z.record(WorkgroveAppGroupNameSchema, WorkgroveAppGroupSchema),
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
  const groups = Object.entries(config.appGroups);
  if (groups.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Workgrove config requires at least one App group",
      path: ["appGroups"],
    });
    return;
  }

  for (const [groupName, group] of groups) {
    const apps = Object.entries(group.apps);
    if (apps.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An App group requires at least one App",
        path: ["appGroups", groupName, "apps"],
      });
      continue;
    }
    const basePorts = new Map<number, string>();
    for (const [appId, app] of apps) {
      const existing = basePorts.get(app.basePort);
      if (existing) {
        context.addIssue({
          code: "custom",
          message: `Base port is already assigned to ${existing}`,
          path: ["appGroups", groupName, "apps", appId, "basePort"],
        });
      } else {
        basePorts.set(app.basePort, appId);
      }
    }
    const maximumSlot = maximumWorkgroveAppGroupSlot(group);
    if (group.slot.default > maximumSlot) {
      context.addIssue({
        code: "custom",
        message: `Default slot exceeds the maximum supported slot ${maximumSlot}`,
        path: ["appGroups", groupName, "slot", "default"],
      });
    }
  }

  for (const [name, template] of Object.entries(config.env ?? {})) {
    const error = workgroveTemplateError(template, config.appGroups);
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

export function maximumWorkgroveAppGroupSlot(
  group: Pick<WorkgroveAppGroup, "apps" | "slot">
): number {
  return Math.min(
    ...Object.values(group.apps).map((app) =>
      Math.floor((MAX_WORKGROVE_PORT - app.basePort) / group.slot.stride)
    )
  );
}

export function maximumWorkgroveSlot(config: WorkgroveConfig): number {
  return Math.min(
    ...Object.values(config.appGroups).map(maximumWorkgroveAppGroupSlot)
  );
}

export function workgroveAppGroupSlotsHavePortCollision(
  group: Pick<WorkgroveAppGroup, "apps" | "slot">,
  leftSlot: number,
  rightSlot: number
): boolean {
  const leftPorts = new Set(
    Object.values(group.apps).map((app) =>
      resolveWorkgroveAppPort(app, leftSlot, group.slot.stride)
    )
  );
  return Object.values(group.apps).some((app) =>
    leftPorts.has(resolveWorkgroveAppPort(app, rightSlot, group.slot.stride))
  );
}

export function cloneWorkgroveConfig(config: WorkgroveConfig): WorkgroveConfig {
  return structuredClone(config);
}
