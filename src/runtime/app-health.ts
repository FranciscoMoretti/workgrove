import {
  resolveWorktreeRuntime,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";

export type AppHealth = "not-running" | "partially-running" | "running";

export interface ControlledApp {
  id: string;
  label: string;
  open: boolean;
  port: number;
  probe: "none" | "tcp";
  required: boolean;
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
  const runtime = resolveWorktreeRuntime(config, {
    [config.slot.env]: String(slot),
  });

  return Object.entries(config.apps).map(([id, appConfig]) => {
    const resolved = runtime.apps[id];
    const probe = appConfig.control?.probe ?? "tcp";

    return {
      id,
      label: appConfig.control?.label ?? displayName(id),
      open: appConfig.control?.open ?? false,
      port: resolved.port,
      probe,
      required: appConfig.control?.required ?? probe === "tcp",
      url: resolved.url,
    };
  });
}

export function appHealth(
  apps: readonly ControlledApp[],
  listeningPorts: ReadonlySet<number>
): AppHealth {
  const required = apps.filter((app) => app.probe === "tcp" && app.required);
  if (required.length === 0) {
    return "not-running";
  }

  const listeningCount = required.filter((app) =>
    listeningPorts.has(app.port)
  ).length;
  if (listeningCount === 0) {
    return "not-running";
  }
  if (listeningCount === required.length) {
    return "running";
  }
  return "partially-running";
}
