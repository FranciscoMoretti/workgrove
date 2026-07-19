import { z } from "zod";

export const WorkgroveCommandSchema = z.strictObject({
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
});

export type WorkgroveCommand = z.infer<typeof WorkgroveCommandSchema>;

export function defaultWorkgroveSetupCommand(): WorkgroveCommand {
  return { argv: ["bun", "install"] };
}

export function defaultWorkgroveStartCommand(): WorkgroveCommand {
  return { argv: ["bun", "run", "dev"] };
}
