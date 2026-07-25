import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PortlessProcess } from "./portless-process";

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

const DEFAULT_PROXY_PORT = 1355;
const OBSERVATION_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PortlessRoutingEngine implements LocalRoutingEngine {
  private readonly proxy: PortlessProcess;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: { port?: number; stateDirectory?: string } = {}) {
    this.port = options.port ?? DEFAULT_PROXY_PORT;
    this.stateDirectory =
      options.stateDirectory ?? join(homedir(), ".workgrove", "portless");
    this.proxy = new PortlessProcess({
      port: this.port,
      stateDirectory: this.stateDirectory,
    });
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
      this.proxy.run([
        "alias",
        this.routeName(route.hostname),
        String(route.port),
      ]);
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
    this.proxy.run(["alias", "--remove", this.routeName(route.hostname)]);
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
    return this.proxy.isLive() ? "active" : "unavailable";
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private async ensureProxy(): Promise<void> {
    if (this.proxy.isLive()) {
      await this.verifyExistingProxy();
      return;
    }
    this.proxy.run(["proxy", "start", "--port", String(this.port), "--no-tls"]);
    await this.waitUntil(
      async () =>
        (await this.proxyResponse("workgrove-probe.localhost")) ===
        "unregistered",
      `Portless proxy did not start on port ${this.port}`
    );
  }

  private async verifyExistingProxy(): Promise<void> {
    const recordedPort = this.proxy.recordedPort();
    if (recordedPort !== this.port) {
      throw new Error(
        `Portless proxy state belongs to port ${recordedPort ?? "unknown"}, not ${this.port}`
      );
    }
    await this.waitUntil(
      async () =>
        (await this.proxyResponse("workgrove-probe.localhost")) ===
        "unregistered",
      `Portless proxy on port ${this.port} is not responding`
    );
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
