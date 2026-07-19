import { z } from "zod";

import { WorkgroveCommandSchema } from "./workgrove-command";
import { workgroveTemplateError } from "./workgrove-template";

export const MIN_WORKGROVE_PORT = 1024;
export const MAX_WORKGROVE_PORT = 65_535;

export const WorkgroveAppGroupNameSchema = z.string().min(1);
export const WorkgroveAppIdSchema = z.string().min(1);
export const WorkgroveEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const HttpReadinessSchema = z.strictObject({
  path: z.string().startsWith("/").default("/"),
  statuses: z
    .string()
    .regex(/^\d{3}-\d{3}$/)
    .refine((range) => {
      const [minimum, maximum] = range.split("-").map(Number);
      return (
        minimum !== undefined &&
        maximum !== undefined &&
        minimum >= 100 &&
        maximum <= 599 &&
        minimum <= maximum
      );
    }, "HTTP status range must be ordered between 100 and 599")
    .default("200-399"),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  type: z.literal("http"),
});

export const WorkgroveReadinessSchema = z.union([
  z.literal("tcp"),
  HttpReadinessSchema,
]);

export const WorkgroveAppSchema = z.strictObject({
  name: z.string().min(1).optional(),
  protocol: z.enum(["http", "tcp"]),
  readiness: WorkgroveReadinessSchema.default("tcp"),
});

export type WorkgroveApp = z.infer<typeof WorkgroveAppSchema>;

export const WorkgroveAppGroupStopSchema = z.union([
  z.literal("process"),
  WorkgroveCommandSchema,
]);

export const WorkgroveAppGroupSchema = z.strictObject({
  name: z.string().min(1).optional(),
  start: WorkgroveCommandSchema,
  stop: WorkgroveAppGroupStopSchema,
  env: z.record(WorkgroveEnvironmentNameSchema, z.string()).optional(),
  apps: z.record(WorkgroveAppIdSchema, WorkgroveAppSchema),
});

export type WorkgroveAppGroup = z.infer<typeof WorkgroveAppGroupSchema>;

const WorkgroveConfigObjectSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  setup: WorkgroveCommandSchema,
  appGroups: z.record(WorkgroveAppGroupNameSchema, WorkgroveAppGroupSchema),
});

type WorkgroveConfigShape = z.infer<typeof WorkgroveConfigObjectSchema>;

export const WorkgroveConfigSchema = WorkgroveConfigObjectSchema.superRefine(
  validateWorkgroveConfig
);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep schema issues colocated with their exact JSON paths.
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

  for (const [groupId, group] of groups) {
    const apps = Object.entries(group.apps);
    if (apps.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An App group requires at least one App",
        path: ["appGroups", groupId, "apps"],
      });
      continue;
    }
    for (const [appId, app] of apps) {
      if (app.protocol === "tcp" && app.readiness !== "tcp") {
        context.addIssue({
          code: "custom",
          message: "TCP Apps support TCP readiness only",
          path: ["appGroups", groupId, "apps", appId, "readiness"],
        });
      }
    }
    for (const [name, template] of Object.entries(group.env ?? {})) {
      const error = workgroveTemplateError(template, config.appGroups, groupId);
      if (error) {
        context.addIssue({
          code: "custom",
          message: error,
          path: ["appGroups", groupId, "env", name],
        });
      }
    }
    for (const [index, argument] of group.start.argv.entries()) {
      const error = workgroveTemplateError(argument, config.appGroups, groupId);
      if (error) {
        context.addIssue({
          code: "custom",
          message: error,
          path: ["appGroups", groupId, "start", "argv", index],
        });
      }
    }
    if (group.stop !== "process") {
      for (const [index, argument] of group.stop.argv.entries()) {
        const error = workgroveTemplateError(
          argument,
          config.appGroups,
          groupId
        );
        if (error) {
          context.addIssue({
            code: "custom",
            message: error,
            path: ["appGroups", groupId, "stop", "argv", index],
          });
        }
      }
    }
  }
}

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

export function cloneWorkgroveConfig(config: WorkgroveConfig): WorkgroveConfig {
  return structuredClone(config);
}
