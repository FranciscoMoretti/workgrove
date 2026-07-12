import {
  resolveWorktreeRuntime,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";

export function commandEnvironment(
  config: WorktreeEnvConfig,
  slot: number
): Record<string, string> {
  const environment = { [config.slot.env]: String(slot) };
  const runtime = resolveWorktreeRuntime(config, environment);
  const apps = Object.values(runtime.apps);
  return apps.length === 1 ? { ...environment, ...apps[0].env } : environment;
}
