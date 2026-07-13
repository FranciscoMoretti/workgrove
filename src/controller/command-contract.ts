import { z } from "zod";
import { WorkgroveCommandSchema } from "../config/workgrove-command";
import { WorkgroveConfigSchema } from "../config/workgrove-schema";

const RepositoryPathSchema = z.object({
  repoPath: z.string().min(1),
});
const StartStopSchema = RepositoryPathSchema.extend({
  worktreeId: z.string().min(1),
});
const VisibleBulkSchema = RepositoryPathSchema.extend({
  worktreeIds: z.array(z.string().min(1)),
});

export const CommandReceiptSchema = z.object({
  command: z.string(),
  message: z.string(),
  ok: z.literal(true),
  worktreeId: z.string().optional(),
});
export const PickRepositoryResultSchema = z.object({
  path: z.string().min(1).nullable(),
});
export const RepositoryInitializationPlanSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  configPath: z.string(),
  detectedRuntime: z.string(),
  detectedStartCommand: z.string().nullable(),
  repoPath: z.string(),
});

const INPUT_SCHEMAS = {
  "clear-logs": StartStopSchema,
  "create-worktree": RepositoryPathSchema.extend({
    branch: z.string().min(1),
    createBranch: z.boolean(),
    folderName: z.string().optional(),
    slot: z.number().int().nonnegative(),
  }),
  "delete-worktree": StartStopSchema,
  "initialize-repository": RepositoryPathSchema,
  "pick-repository": z.object({}),
  "preview-repository-config": RepositoryPathSchema,
  "restart-apps": StartStopSchema,
  "restart-running-apps": VisibleBulkSchema,
  "set-slot": StartStopSchema.extend({
    slot: z.number().int().nonnegative(),
  }),
  "setup-all-apps": VisibleBulkSchema,
  "start-all-apps": VisibleBulkSchema,
  "start-apps": StartStopSchema,
  "stop-all-apps": VisibleBulkSchema,
  "stop-apps": StartStopSchema,
  "trust-repository": RepositoryPathSchema,
  "update-repository-commands": RepositoryPathSchema.extend({
    setup: WorkgroveCommandSchema.nullable(),
    start: WorkgroveCommandSchema.nullable().optional(),
  }),
  "update-repository-config": RepositoryPathSchema.extend({
    config: WorkgroveConfigSchema,
    revision: z.string().min(1),
  }),
} as const;

const RESULT_SCHEMAS = {
  "clear-logs": CommandReceiptSchema,
  "create-worktree": CommandReceiptSchema,
  "delete-worktree": CommandReceiptSchema,
  "initialize-repository": RepositoryInitializationPlanSchema,
  "pick-repository": PickRepositoryResultSchema,
  "preview-repository-config": RepositoryInitializationPlanSchema,
  "restart-apps": CommandReceiptSchema,
  "restart-running-apps": CommandReceiptSchema,
  "set-slot": CommandReceiptSchema,
  "setup-all-apps": CommandReceiptSchema,
  "start-all-apps": CommandReceiptSchema,
  "start-apps": CommandReceiptSchema,
  "stop-all-apps": CommandReceiptSchema,
  "stop-apps": CommandReceiptSchema,
  "trust-repository": CommandReceiptSchema,
  "update-repository-commands": CommandReceiptSchema,
  "update-repository-config": CommandReceiptSchema,
} as const;

export type WorkgroveCommandName = keyof typeof INPUT_SCHEMAS;
export type WorkgroveCommandInput<Name extends WorkgroveCommandName> = z.infer<
  (typeof INPUT_SCHEMAS)[Name]
>;
export type WorkgroveCommandResult<Name extends WorkgroveCommandName> = z.infer<
  (typeof RESULT_SCHEMAS)[Name]
>;

export function isWorkgroveCommandName(
  value: string
): value is WorkgroveCommandName {
  return value in INPUT_SCHEMAS;
}

export function parseCommandInput<Name extends WorkgroveCommandName>(
  name: Name,
  input: unknown
): WorkgroveCommandInput<Name> {
  return INPUT_SCHEMAS[name].parse(input) as WorkgroveCommandInput<Name>;
}

export function parseCommandResult<Name extends WorkgroveCommandName>(
  name: Name,
  result: unknown
): WorkgroveCommandResult<Name> {
  return RESULT_SCHEMAS[name].parse(result) as WorkgroveCommandResult<Name>;
}
