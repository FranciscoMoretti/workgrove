import { z } from "zod";

export const WorkgroveCommandSchema = z.object({
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type WorkgroveCommand = z.infer<typeof WorkgroveCommandSchema>;

export interface RepositoryCommandProfile {
  setup: WorkgroveCommand | null;
  start: WorkgroveCommand | null;
  startMode: "aggregate" | "none" | "per-app";
}
