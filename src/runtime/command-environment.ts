import {
  type WorktreeEnvConfig,
  workgroveCommandEnvironment,
} from "../config/workgrove-config";

export function commandEnvironment(
  config: WorktreeEnvConfig,
  slot: number
): Record<string, string> {
  return workgroveCommandEnvironment(config, slot);
}
