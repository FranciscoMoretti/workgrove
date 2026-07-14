import type { WorkgroveCommand } from "./workgrove-command";
import {
  MAX_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  type WorkgroveAppPort,
  type WorkgroveConfig,
} from "./workgrove-schema";
import {
  renameWorkgroveTemplateAppReference,
  renderWorkgroveTemplate,
  workgroveTemplateAppReferences,
} from "./workgrove-template";

export type WorkgroveLaunchMode = "aggregate" | "none" | "per-app";

export function workgroveLaunchMode(
  config: Pick<WorkgroveConfig, "apps" | "control">
): WorkgroveLaunchMode {
  if (config.control?.start) {
    return "aggregate";
  }
  return Object.values(config.apps).some((app) => app.start)
    ? "per-app"
    : "none";
}

export function withWorkgroveLaunchMode(
  config: Pick<WorkgroveConfig, "apps" | "control">,
  mode: WorkgroveLaunchMode
): Pick<WorkgroveConfig, "apps" | "control"> {
  const apps = structuredClone(config.apps);
  const control = structuredClone(config.control ?? {});
  if (mode !== "aggregate") {
    control.start = undefined;
  }
  if (mode !== "per-app") {
    for (const app of Object.values(apps)) {
      app.start = undefined;
    }
  }
  if (mode === "aggregate") {
    control.start ??= { argv: [""] };
  }
  if (mode === "per-app") {
    const requiredIds = Object.entries(apps)
      .filter(([, app]) => {
        const probe = app.control?.probe ?? "tcp";
        return probe === "tcp" && (app.control?.required ?? true);
      })
      .map(([id]) => id);
    const targets = new Set(
      requiredIds.length > 0 ? requiredIds : Object.keys(apps).slice(0, 1)
    );
    for (const [id, app] of Object.entries(apps)) {
      if (targets.has(id)) {
        app.start ??= { argv: [""] };
      }
    }
  }
  return {
    apps,
    control: control.setup || control.start ? control : undefined,
  };
}

function portLane(port: number, stride: number): number {
  return ((port % stride) + stride) % stride;
}

export function nextAvailableWorkgroveAppPort(
  apps: Record<string, WorkgroveApp>,
  ports: WorkgroveConfig["ports"]
): WorkgroveAppPort {
  const usedLanes = new Set(
    Object.values(apps).map((app) =>
      portLane(resolveWorkgroveAppPort({ ports }, app, 0), ports.slotStride)
    )
  );
  for (let offset = 0; offset < ports.slotStride; offset += 1) {
    if (!usedLanes.has(portLane(ports.base + offset, ports.slotStride))) {
      return { offset };
    }
  }
  for (
    let base = ports.base + ports.slotStride;
    base <= MAX_WORKGROVE_PORT;
    base += 1
  ) {
    if (!usedLanes.has(portLane(base, ports.slotStride))) {
      return { base };
    }
  }
  throw new Error("No collision-free app port lane is available");
}

function mapCommandTemplates(
  command: WorkgroveCommand | undefined,
  map: (value: string) => string
): WorkgroveCommand | undefined {
  if (!command) {
    return undefined;
  }
  return {
    argv: command.argv.map(map),
    cwd: command.cwd ? map(command.cwd) : undefined,
    env: command.env
      ? Object.fromEntries(
          Object.entries(command.env).map(([name, value]) => [name, map(value)])
        )
      : undefined,
  };
}

function configTemplateValues(config: WorkgroveConfig): string[] {
  const commands = [
    config.control?.setup,
    config.control?.start,
    ...Object.values(config.apps).map((app) => app.start),
  ];
  return [
    config.url,
    ...Object.values(config.apps).flatMap((app) =>
      Object.values(app.exports ?? {})
    ),
    ...commands.flatMap((command) => [
      ...(command?.argv ?? []),
      ...(command?.cwd ? [command.cwd] : []),
      ...Object.values(command?.env ?? {}),
    ]),
  ];
}

export function workgroveAppReferenceCount(
  config: WorkgroveConfig,
  appId: string
): number {
  return configTemplateValues(config).reduce(
    (count, value) =>
      count +
      workgroveTemplateAppReferences(value).filter((id) => id === appId).length,
    0
  );
}

export function renameWorkgroveApp(
  config: WorkgroveConfig,
  previousId: string,
  nextId: string
): WorkgroveConfig {
  const map = (value: string) =>
    renameWorkgroveTemplateAppReference(value, previousId, nextId);
  return {
    ...config,
    url: map(config.url),
    apps: Object.fromEntries(
      Object.entries(config.apps).map(([id, app]) => [
        id === previousId ? nextId : id,
        {
          ...app,
          exports: app.exports
            ? Object.fromEntries(
                Object.entries(app.exports).map(([name, value]) => [
                  name,
                  map(value),
                ])
              )
            : undefined,
          start: mapCommandTemplates(app.start, map),
        },
      ])
    ),
    control: config.control
      ? {
          setup: mapCommandTemplates(config.control.setup, map),
          start: mapCommandTemplates(config.control.start, map),
        }
      : undefined,
  };
}

export function resolveWorkgroveAppEndpoints(
  config: WorkgroveConfig,
  slot: number
): Record<string, { port: number; url: string }> {
  const ports = Object.fromEntries(
    Object.entries(config.apps).map(([id, app]) => [
      id,
      resolveWorkgroveAppPort(config, app, slot),
    ])
  );
  const apps: Record<string, { port: number; url: string }> = {};
  for (const [id, port] of Object.entries(ports)) {
    apps[id] = { port, url: "" };
  }
  for (const app of Object.values(apps)) {
    app.url = renderWorkgroveTemplate(config.url, {
      apps,
      port: app.port,
      slot,
    });
  }
  return apps;
}
