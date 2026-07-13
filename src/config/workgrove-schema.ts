import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;

const APP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const WorkgroveAppIdSchema = z.string().regex(APP_ID_PATTERN);

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
  offset: z.number().int().nonnegative(),
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

export const WorkgroveConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
    control: WorkgroveControlSchema.optional(),
    range: z.object({
      base: z.number().int().min(MIN_WORKGROVE_PORT).max(MAX_WORKGROVE_PORT),
      stride: z.number().int().positive().max(MAX_WORKGROVE_PORT),
    }),
    slot: z.object({
      default: z.number().int().nonnegative(),
      env: z.string().regex(ENVIRONMENT_NAME_PATTERN),
      file: z.string().min(1).optional(),
    }),
    url: z.string().min(1),
  })
  .superRefine((config, context) => {
    const apps = Object.entries(config.apps);
    if (apps.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Workgrove config requires at least one app",
        path: ["apps"],
      });
      return;
    }

    const perAppEntries = apps.filter(([, app]) => app.start !== undefined);
    if (perAppEntries.length > 0 && config.control?.start) {
      context.addIssue({
        code: "custom",
        message:
          "Configure either per-app start commands or control.start, not both",
        path: ["control", "start"],
      });
    }

    if (perAppEntries.length > 0) {
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

    const offsets = new Map<number, string>();
    for (const [id, app] of apps) {
      if (app.offset >= config.range.stride) {
        context.addIssue({
          code: "custom",
          message: "Offset must be below range stride",
          path: ["apps", id, "offset"],
        });
      }
      const existing = offsets.get(app.offset);
      if (existing) {
        context.addIssue({
          code: "custom",
          message: `Offset is already assigned to ${existing}`,
          path: ["apps", id, "offset"],
        });
      } else {
        offsets.set(app.offset, id);
      }
      const port =
        config.range.base +
        config.slot.default * config.range.stride +
        app.offset;
      if (port > MAX_WORKGROVE_PORT) {
        context.addIssue({
          code: "custom",
          message: `Default slot computes invalid port ${port}`,
          path: ["apps", id, "offset"],
        });
      }
    }
  });

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

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
