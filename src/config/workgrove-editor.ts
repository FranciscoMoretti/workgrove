import {
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  type WorkgroveConfig,
} from "./workgrove-schema";

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
  };
}

export function resolveWorkgroveAppEndpoints(
  config: WorkgroveConfig,
  slot: number
): Record<string, { port: number; url: string }> {
  return Object.fromEntries(
    Object.entries(config.apps).map(([id, app]) => {
      const port = resolveWorkgroveAppPort(app, slot);
      return [id, { port, url: `http://localhost:${port}` }];
    })
  );
}
