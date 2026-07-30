import { z } from "zod";

export const BranchBaseCommandSchema = z.strictObject({
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
});

export type BranchBaseCommand = z.infer<typeof BranchBaseCommandSchema>;

export function defaultBranchBaseSetupCommand(): BranchBaseCommand {
  return { argv: ["bun", "install"] };
}

export function defaultBranchBaseStartCommand(): BranchBaseCommand {
  return { argv: ["bun", "run", "dev"] };
}
