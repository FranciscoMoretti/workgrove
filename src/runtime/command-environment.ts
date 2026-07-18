import {
  type WorktreeEnvConfig,
  workgroveCommandEnvironment,
} from "../config/workgrove-config";

export function commandEnvironment(
  config: WorktreeEnvConfig,
  slots: Record<string, number>
): Record<string, string> {
  return workgroveCommandEnvironment(config, slots);
}
