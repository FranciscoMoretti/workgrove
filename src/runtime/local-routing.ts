import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { processIsLive } from "../host/process-inspection";

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

interface PortlessRoute {
  hostname: string;
  pid: number;
  port: number;
}

const require = createRequire(import.meta.url);
const DEFAULT_PROXY_PORT = 1355;
const OBSERVATION_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PortlessRoutingEngine implements LocalRoutingEngine {
  private readonly cliPath: string;
  private readonly nodePath: string;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: { port?: number; stateDirectory?: string } = {}) {
    this.cliPath = packageFile("portless", "dist", "cli.js");
    this.nodePath = packageFile("node", "bin", "node");
    this.port = options.port ?? DEFAULT_PROXY_PORT;
    this.stateDirectory =
      options.stateDirectory ?? join(homedir(), ".workgrove", "portless");
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
    const pid = this.proxyPid();
    return pid !== null && processIsLive(pid) ? "active" : "unavailable";
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private async ensureProxy(): Promise<void> {
    const pid = this.proxyPid();
    if (pid !== null && processIsLive(pid)) {
      return;
    }
    this.run(["proxy", "start", "--port", String(this.port), "--no-tls"]);
    await this.waitUntil(
      async () =>
        (await this.proxyResponse("workgrove-probe.localhost")) !==
        "unavailable",
      `Portless proxy did not start on port ${this.port}`
    );
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

  private proxyPid(): number | null {
    const path = join(this.stateDirectory, "proxy.pid");
    if (!existsSync(path)) {
      return null;
    }
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }

  private route(hostname: string): PortlessRoute | null {
    const path = join(this.stateDirectory, "routes.json");
    if (!existsSync(path)) {
      return null;
    }
    try {
      const routes = JSON.parse(readFileSync(path, "utf8")) as PortlessRoute[];
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
