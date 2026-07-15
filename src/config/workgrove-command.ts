import { z } from "zod";

export const WorkgroveCommandSchema = z.strictObject({
  argv: z.array(z.string().min(1)).min(1),
});

export type WorkgroveCommand = z.infer<typeof WorkgroveCommandSchema>;

export function defaultWorkgroveSetupCommand(): WorkgroveCommand {
  return { argv: ["npm", "install"] };
}

export function defaultWorkgroveStartCommand(): WorkgroveCommand {
  return { argv: ["npm", "run", "dev"] };
}
