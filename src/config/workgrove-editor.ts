import {
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  type WorkgroveConfig,
} from "./workgrove-schema";
import { renameWorkgroveAppTemplateReferences } from "./workgrove-template";

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

export function renameWorkgroveApp(
  config: WorkgroveConfig,
  previousId: string,
  nextId: string
): WorkgroveConfig {
  return {
    ...config,
    apps: Object.fromEntries(
      Object.entries(config.apps).map(([id, app]) => [
        id === previousId ? nextId : id,
        app,
      ])
    ),
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([name, template]) => [
            name,
            renameWorkgroveAppTemplateReferences(template, previousId, nextId),
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
  const firstApp = Object.keys(config.apps)[0];
  return {
    ...config,
    env: {
      ...config.env,
      [name]: firstApp ? `{apps.${firstApp}.port}` : "",
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
  slot: number
): Record<string, { port: number; url: string }> {
  return Object.fromEntries(
    Object.entries(config.apps).map(([id, app]) => {
      const port = resolveWorkgroveAppPort(app, slot, config.stride);
      return [id, { port, url: `http://localhost:${port}` }];
    })
  );
}
