import {
  resolveWorkgroveAppGroup,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";

export type AppHealth = "not-running" | "partially-running" | "running";

export interface ControlledApp {
  id: string;
  label: string;
  open: true;
  port: number;
  probe: "tcp";
  required: true;
  url: string;
}

export function resolveControlledApps(
  config: WorktreeEnvConfig,
  groupName: string,
  slot: number
): ControlledApp[] {
  const appGroup = resolveWorkgroveAppGroup(config, groupName, slot);
  return Object.entries(appGroup.apps).map(([id, app]) => ({
    id,
    label: id,
    open: true,
    port: app.port,
    probe: "tcp",
    required: true,
    url: app.url,
  }));
}

export function appHealth(
  apps: readonly ControlledApp[],
  listeningPorts: ReadonlySet<number>
): AppHealth {
  const listeningCount = apps.filter((app) =>
    listeningPorts.has(app.port)
  ).length;
  if (listeningCount === 0) {
    return "not-running";
  }
  return listeningCount === apps.length ? "running" : "partially-running";
}
