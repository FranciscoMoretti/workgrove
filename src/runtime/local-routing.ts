import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { processIsLive, processStartMarker } from "../host/process-inspection";
import { inspectListeningPorts, listeningPortPids } from "./ports";

export interface LocalRoute {
  hostname: string;
  port: number;
}

export type LocalRouteState =
  | "active"
  | "conflict"
  | "inactive"
  | "unavailable";

export interface LocalRoutingEngine {
  activate(route: LocalRoute): Promise<void>;
  deactivate(route: LocalRoute): Promise<void>;
  observe(route: LocalRoute): LocalRouteState;
  prepare?(): Promise<void>;
  url(hostname: string): string;
}

const PortlessRouteSchema = z.strictObject({
  hostname: z.string().min(1),
  ngrokPid: z.number().int().positive().optional(),
  ngrokUrl: z.string().min(1).optional(),
  pid: z.number().int().nonnegative(),
  port: z.number().int().min(1).max(65_535),
  tailscaleFunnel: z.boolean().optional(),
  tailscaleHttpsPort: z.number().int().min(1).max(65_535).optional(),
  tailscaleUrl: z.string().min(1).optional(),
});
const PortlessRoutesSchema = z.array(PortlessRouteSchema);
type PortlessRoute = z.infer<typeof PortlessRouteSchema>;
const ProxyOwnerSchema = z.strictObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  startMarker: z.string().min(1).max(256),
});
type ProxyOwner = z.infer<typeof ProxyOwnerSchema>;

const require = createRequire(import.meta.url);
const DEFAULT_PROXY_PORT = 1355;
const OBSERVATION_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;
const PROXY_OWNER_FILE = "workgrove-proxy-owner.json";

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numberFile(path: string): number | null {
  if (!existsSync(path)) {
    return null;
  }
  const value = Number(readFileSync(path, "utf8").trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function proxyPid(stateDirectory: string): number | null {
  return numberFile(join(stateDirectory, "proxy.pid"));
}

function proxyPort(stateDirectory: string): number | null {
  const port = numberFile(join(stateDirectory, "proxy.port"));
  return port !== null && port <= 65_535 ? port : null;
}

function proxyOwner(stateDirectory: string): ProxyOwner | null {
  try {
    return ProxyOwnerSchema.parse(
      JSON.parse(readFileSync(join(stateDirectory, PROXY_OWNER_FILE), "utf8"))
    );
  } catch {
    return null;
  }
}

export class PortlessProxyPortConflictError extends Error {
  constructor(port: number) {
    super(`Portless proxy port ${port} is already in use`);
    this.name = "PortlessProxyPortConflictError";
  }
}

export class PortlessRoutingEngine implements LocalRoutingEngine {
  private readonly cliPath: string;
  private readonly exclusiveOwnership: boolean;
  private readonly nodePath: string;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(
    options: {
      exclusiveOwnership?: boolean;
      port?: number;
      stateDirectory?: string;
    } = {}
  ) {
    this.cliPath = packageFile("portless", "dist", "cli.js");
    this.exclusiveOwnership = options.exclusiveOwnership ?? false;
    this.nodePath = packageFile("node", "bin", "node");
    this.port = options.port ?? DEFAULT_PROXY_PORT;
    this.stateDirectory =
      options.stateDirectory ?? join(homedir(), ".workgrove", "portless");
  }

  static ownedProxyPort(stateDirectory: string): number | null {
    const owner = proxyOwner(stateDirectory);
    const pid = proxyPid(stateDirectory);
    const port = proxyPort(stateDirectory);
    return owner &&
      pid === owner.pid &&
      port === owner.port &&
      processIsLive(owner.pid) &&
      processStartMarker(owner.pid) === owner.startMarker
      ? owner.port
      : null;
  }

  async activate(route: LocalRoute): Promise<void> {
    await this.ensureProxy();
    const current = this.route(route.hostname);
    if (current && current.port !== route.port) {
      throw new Error(
        `${route.hostname} is already routed to backing port ${current.port}`
      );
    }
    if (!current) {
      this.run(["alias", this.routeName(route.hostname), String(route.port)]);
    }
    await this.waitUntil(
      async () =>
        this.route(route.hostname)?.port === route.port &&
        (await this.proxyResponse(route.hostname)) === "routed",
      `Portless did not activate ${route.hostname}`
    );
  }

  async prepare(): Promise<void> {
    await this.ensureProxy();
  }

  stopProxy(): void {
    this.run(["proxy", "stop", "--port", String(this.port)]);
  }

  stopOwnedProxy(): void {
    if (
      PortlessRoutingEngine.ownedProxyPort(this.stateDirectory) !== this.port
    ) {
      throw new Error(
        `Refusing to stop an unowned Portless proxy on port ${this.port}`
      );
    }
    this.stopProxy();
    rmSync(join(this.stateDirectory, PROXY_OWNER_FILE), { force: true });
  }

  async deactivate(route: LocalRoute): Promise<void> {
    const current = this.route(route.hostname);
    if (!current) {
      return;
    }
    if (current.port !== route.port) {
      throw new Error(
        `Refusing to remove ${route.hostname}; it points to backing port ${current.port}`
      );
    }
    this.run(["alias", "--remove", this.routeName(route.hostname)]);
    await this.waitUntil(
      async () =>
        this.route(route.hostname) === null &&
        (await this.proxyResponse(route.hostname)) === "unregistered",
      `Portless did not deactivate ${route.hostname}`
    );
  }

  observe(route: LocalRoute): LocalRouteState {
    const current = this.route(route.hostname);
    if (!current) {
      return "inactive";
    }
    if (current.port !== route.port) {
      return "conflict";
    }
    const pid = proxyPid(this.stateDirectory);
    const owned =
      !this.exclusiveOwnership ||
      PortlessRoutingEngine.ownedProxyPort(this.stateDirectory) === this.port;
    return pid !== null && processIsLive(pid) && owned
      ? "active"
      : "unavailable";
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private async ensureProxy(): Promise<void> {
    const pid = proxyPid(this.stateDirectory);
    if (pid !== null && processIsLive(pid)) {
      await this.verifyExistingProxy();
      return;
    }
    if (this.exclusiveOwnership && this.portIsOccupied()) {
      throw new PortlessProxyPortConflictError(this.port);
    }
    this.startProxy();
    if (this.exclusiveOwnership) {
      this.recordStartedProxy();
    }
    await this.waitUntil(
      async () =>
        (await this.proxyResponse("workgrove-probe.localhost")) ===
        "unregistered",
      `Portless proxy did not start on port ${this.port}`
    );
  }

  private portIsOccupied(): boolean {
    return listeningPortPids(inspectListeningPorts(), this.port).length > 0;
  }

  private recordStartedProxy(): void {
    try {
      this.recordProxyOwnership();
    } catch (error) {
      if (proxyPid(this.stateDirectory) === null && this.portIsOccupied()) {
        throw new PortlessProxyPortConflictError(this.port);
      }
      throw error;
    }
  }

  private startProxy(): void {
    try {
      this.run(["proxy", "start", "--port", String(this.port), "--no-tls"]);
    } catch (error) {
      if (this.exclusiveOwnership && this.portIsOccupied()) {
        throw new PortlessProxyPortConflictError(this.port);
      }
      throw error;
    }
  }

  private async verifyExistingProxy(): Promise<void> {
    const recordedPort = proxyPort(this.stateDirectory);
    if (recordedPort !== this.port) {
      throw new Error(
        `Portless proxy state belongs to port ${recordedPort ?? "unknown"}, not ${this.port}`
      );
    }
    if (
      this.exclusiveOwnership &&
      PortlessRoutingEngine.ownedProxyPort(this.stateDirectory) !== this.port
    ) {
      throw new Error(
        `Portless proxy state on port ${this.port} is not owned by this Workgrove profile`
      );
    }
    await this.waitUntil(
      async () =>
        (await this.proxyResponse("workgrove-probe.localhost")) ===
        "unregistered",
      `Portless proxy on port ${this.port} is not responding`
    );
  }

  private recordProxyOwnership(): void {
    const pid = proxyPid(this.stateDirectory);
    if (!(pid && processIsLive(pid))) {
      throw new Error("Portless did not publish a live proxy process");
    }
    const owner = ProxyOwnerSchema.parse({
      pid,
      port: this.port,
      startMarker: processStartMarker(pid),
    });
    mkdirSync(this.stateDirectory, { recursive: true });
    const file = join(this.stateDirectory, PROXY_OWNER_FILE);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(owner)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  private environment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PORTLESS_HTTPS: "0",
      PORTLESS_PORT: String(this.port),
      PORTLESS_STATE_DIR: this.stateDirectory,
      PORTLESS_SYNC_HOSTS: "0",
      PORTLESS_TLD: "localhost",
    };
  }

  private async proxyResponse(
    hostname: string
  ): Promise<"routed" | "unavailable" | "unregistered"> {
    try {
      const response = await fetch(`${this.url(hostname)}/`, {
        signal: AbortSignal.timeout(500),
      });
      const body = await response.text();
      if (
        response.status === 404 &&
        body.includes(`No app registered for <strong>${hostname}</strong>`)
      ) {
        return "unregistered";
      }
      return response.status === 502 ? "unavailable" : "routed";
    } catch {
      return "unavailable";
    }
  }

  private route(hostname: string): PortlessRoute | null {
    const path = join(this.stateDirectory, "routes.json");
    if (!existsSync(path)) {
      return null;
    }
    try {
      const routes = PortlessRoutesSchema.parse(
        JSON.parse(readFileSync(path, "utf8"))
      );
      return routes.find((route) => route.hostname === hostname) ?? null;
    } catch {
      throw new Error("Portless route state is invalid");
    }
  }

  private routeName(hostname: string): string {
    return hostname.endsWith(".localhost")
      ? hostname.slice(0, -".localhost".length)
      : hostname;
  }

  private run(args: string[]): void {
    const result = spawnSync(this.nodePath, [this.cliPath, ...args], {
      encoding: "utf8",
      env: this.environment(),
      timeout: 10_000,
    });
    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || "Portless command failed").trim()
      );
    }
  }

  private async waitUntil(
    condition: () => Promise<boolean>,
    message: string
  ): Promise<void> {
    const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error(message);
  }
}
