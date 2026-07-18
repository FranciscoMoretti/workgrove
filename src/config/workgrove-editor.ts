import {
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  type WorkgroveConfig,
} from "./workgrove-schema";
import {
  renameWorkgroveAppGroupTemplateReferences,
  renameWorkgroveAppTemplateReferences,
} from "./workgrove-template";

export function nextAvailableWorkgroveAppBasePort(
  apps: Record<string, WorkgroveApp>
): number {
  const usedPorts = new Set(Object.values(apps).map((app) => app.basePort));
  for (let port = 3000; port <= MAX_WORKGROVE_PORT; port += 1) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  for (let port = MIN_WORKGROVE_PORT; port < 3000; port += 1) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  throw new Error("No app base port is available");
}

export function renameWorkgroveAppGroup(
  config: WorkgroveConfig,
  previousName: string,
  nextName: string
): WorkgroveConfig {
  return {
    ...config,
    appGroups: Object.fromEntries(
      Object.entries(config.appGroups).map(([name, group]) => [
        name === previousName ? nextName : name,
        group,
      ])
    ),
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([name, template]) => [
            name,
            renameWorkgroveAppGroupTemplateReferences(
              template,
              previousName,
              nextName
            ),
          ])
        )
      : undefined,
  };
}

export function renameWorkgroveApp(
  config: WorkgroveConfig,
  groupName: string,
  previousId: string,
  nextId: string
): WorkgroveConfig {
  const group = config.appGroups[groupName];
  if (!group) {
    return config;
  }
  return {
    ...config,
    appGroups: {
      ...config.appGroups,
      [groupName]: {
        ...group,
        apps: Object.fromEntries(
          Object.entries(group.apps).map(([id, app]) => [
            id === previousId ? nextId : id,
            app,
          ])
        ),
      },
    },
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([name, template]) => [
            name,
            renameWorkgroveAppTemplateReferences(
              template,
              groupName,
              previousId,
              nextId
            ),
          ])
        )
      : undefined,
  };
}

export function addWorkgroveEnvironment(
  config: WorkgroveConfig
): WorkgroveConfig {
  let name = "APP_PORT";
  let suffix = 2;
  while (Object.hasOwn(config.env ?? {}, name)) {
    name = `APP_PORT_${suffix}`;
    suffix += 1;
  }
  const [groupName, group] = Object.entries(config.appGroups)[0] ?? [];
  const firstApp = group ? Object.keys(group.apps)[0] : undefined;
  return {
    ...config,
    env: {
      ...config.env,
      [name]:
        groupName && firstApp
          ? `{appGroups.${groupName}.apps.${firstApp}.port}`
          : "",
    },
  };
}

export function renameWorkgroveEnvironment(
  config: WorkgroveConfig,
  previousName: string,
  nextName: string
): WorkgroveConfig {
  return {
    ...config,
    env: Object.fromEntries(
      Object.entries(config.env ?? {}).map(([name, template]) => [
        name === previousName ? nextName : name,
        template,
      ])
    ),
  };
}

export function deleteWorkgroveEnvironment(
  config: WorkgroveConfig,
  name: string
): WorkgroveConfig {
  return {
    ...config,
    env: Object.fromEntries(
      Object.entries(config.env ?? {}).filter(([key]) => key !== name)
    ),
  };
}

export function resolveWorkgroveAppEndpoints(
  config: WorkgroveConfig,
  groupName: string,
  slot: number
): Record<string, { port: number; url: string }> {
  const group = config.appGroups[groupName];
  if (!group) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(group.apps).map(([id, app]) => {
      const port = resolveWorkgroveAppPort(app, slot, group.slot.stride);
      return [id, { port, url: `http://localhost:${port}` }];
    })
  );
}
