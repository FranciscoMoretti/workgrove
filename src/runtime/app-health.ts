import {
  resolveWorkgroveAppGroup,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import { WORKGROVE_SLOT_ENV } from "../config/workgrove-schema";

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

function displayName(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolveControlledApps(
  config: WorktreeEnvConfig,
  slot: number
): ControlledApp[] {
  const appGroup = resolveWorkgroveAppGroup(config, {
    [WORKGROVE_SLOT_ENV]: String(slot),
  });
  return Object.entries(appGroup.apps).map(([id, app]) => ({
    id,
    label: displayName(id),
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
