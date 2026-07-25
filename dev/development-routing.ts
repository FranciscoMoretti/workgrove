import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import {
  processIsLive,
  processStartMarker,
} from "../src/host/process-inspection";
import {
  type LocalRoute,
  type LocalRouteState,
  type LocalRoutingEngine,
  PortlessRoutingEngine,
} from "../src/runtime/local-routing";
import { PortlessProcess } from "../src/runtime/portless-process";
import { inspectListeningPorts, listeningPortPids } from "../src/runtime/ports";

const ProxyOwnerSchema = z.strictObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  startMarker: z.string().min(1).max(256),
});
type ProxyOwner = z.infer<typeof ProxyOwnerSchema>;

const PROXY_OWNER_FILE = "workgrove-proxy-owner.json";
const STARTED_PROXY_OBSERVATION_MS = 5000;
const STARTED_PROXY_POLL_MS = 25;
const GRACEFUL_PROXY_STOP_MS = 2500;
const FORCED_PROXY_STOP_MS = 500;
const STOPPED_PROXY_POLL_MS = 25;
const synchronousWaitState = new Int32Array(new SharedArrayBuffer(4));

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function processMatchesOwner(
  owner: ProxyOwner,
  proxy: PortlessProcess
): boolean {
  return (
    proxy.pid() === owner.pid &&
    proxy.recordedPort() === owner.port &&
    processIsLive(owner.pid) &&
    processStartMarker(owner.pid) === owner.startMarker
  );
}

function ownerProcessIsLive(owner: ProxyOwner): boolean {
  return (
    processIsLive(owner.pid) &&
    processStartMarker(owner.pid) === owner.startMarker
  );
}

function waitForOwnerProcessToStop(
  owner: ProxyOwner,
  timeoutMilliseconds: number
): boolean {
  const deadline = Date.now() + timeoutMilliseconds;
  while (processIsLive(owner.pid) && Date.now() < deadline) {
    Atomics.wait(synchronousWaitState, 0, 0, STOPPED_PROXY_POLL_MS);
  }
  return !ownerProcessIsLive(owner);
}

function signalOwnerProcess(
  owner: ProxyOwner,
  signal: NodeJS.Signals
): boolean {
  try {
    process.kill(owner.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

export class DevelopmentProxyPortConflictError extends Error {
  constructor(port: number) {
    super(`Portless proxy port ${port} is already in use`);
    this.name = "DevelopmentProxyPortConflictError";
  }
}

export class DevelopmentRouting implements LocalRoutingEngine {
  private readonly proxy: PortlessProcess;
  private readonly routing: PortlessRoutingEngine;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: { port: number; stateDirectory: string }) {
    this.port = options.port;
    this.stateDirectory = options.stateDirectory;
    this.proxy = new PortlessProcess(options);
    this.routing = new PortlessRoutingEngine(options);
  }

  static ownedProxyPort(stateDirectory: string): number | null {
    const owner = proxyOwner(stateDirectory);
    if (!owner) {
      return null;
    }
    const proxy = new PortlessProcess({
      port: owner.port,
      stateDirectory,
    });
    return processMatchesOwner(owner, proxy) ? owner.port : null;
  }

  async activate(route: LocalRoute): Promise<void> {
    await this.prepare();
    await this.routing.activate(route);
  }

  async deactivate(route: LocalRoute): Promise<void> {
    await this.routing.deactivate(route);
  }

  observe(route: LocalRoute): LocalRouteState {
    const observed = this.routing.observe(route);
    return observed === "active" &&
      DevelopmentRouting.ownedProxyPort(this.stateDirectory) !== this.port
      ? "unavailable"
      : observed;
  }

  async prepare(): Promise<void> {
    const ownedPort = DevelopmentRouting.ownedProxyPort(this.stateDirectory);
    if (ownedPort === this.port) {
      await this.routing.prepare();
      return;
    }

    if (this.proxy.isLive()) {
      throw new Error(
        `Portless proxy state on port ${this.port} is not owned by this Workgrove development session`
      );
    }
    if (this.portIsOccupied()) {
      throw new DevelopmentProxyPortConflictError(this.port);
    }

    let startError: unknown;
    let startedOwner: ProxyOwner | null = null;
    try {
      try {
        this.proxy.run([
          "proxy",
          "start",
          "--port",
          String(this.port),
          "--no-tls",
        ]);
      } catch (error) {
        startError = error;
      }
      startedOwner = await this.observeStartedProxy();
      if (!startedOwner) {
        if (this.portIsOccupied()) {
          throw new DevelopmentProxyPortConflictError(this.port);
        }
        if (startError) {
          throw startError;
        }
        throw new Error("Portless did not publish a live proxy process");
      }
      this.recordProxyOwnership(startedOwner);
    } catch (error) {
      try {
        if (
          DevelopmentRouting.ownedProxyPort(this.stateDirectory) === this.port
        ) {
          this.stopOwnedProxy();
        } else if (
          startedOwner &&
          processMatchesOwner(startedOwner, this.proxy)
        ) {
          this.stopVerifiedProxy(startedOwner);
        }
      } catch {
        // Preserve the startup error after best-effort cleanup.
      }
      throw error;
    }
    await this.routing.prepare();
  }

  stopOwnedProxy(): void {
    const owner = proxyOwner(this.stateDirectory);
    if (!(owner && processMatchesOwner(owner, this.proxy))) {
      throw new Error(
        `Refusing to stop an unowned Portless proxy on port ${this.port}`
      );
    }
    this.stopVerifiedProxy(owner);
    rmSync(join(this.stateDirectory, PROXY_OWNER_FILE), { force: true });
  }

  url(hostname: string): string {
    return this.routing.url(hostname);
  }

  private portIsOccupied(): boolean {
    return listeningPortPids(inspectListeningPorts(), this.port).length > 0;
  }

  private recordProxyOwnership(owner: ProxyOwner): void {
    mkdirSync(this.stateDirectory, { recursive: true });
    const file = join(this.stateDirectory, PROXY_OWNER_FILE);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
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

  private async observeStartedProxy(): Promise<ProxyOwner | null> {
    const deadline = Date.now() + STARTED_PROXY_OBSERVATION_MS;
    do {
      const owner = this.startedProxyOwner();
      if (owner) {
        return owner;
      }
      await delay(STARTED_PROXY_POLL_MS);
    } while (Date.now() < deadline);
    return null;
  }

  private startedProxyOwner(): ProxyOwner | null {
    const pid = this.proxy.pid();
    const startMarker = pid ? processStartMarker(pid) : null;
    if (
      !(
        pid &&
        processIsLive(pid) &&
        this.proxy.recordedPort() === this.port &&
        startMarker
      )
    ) {
      return null;
    }
    return ProxyOwnerSchema.parse({
      pid,
      port: this.port,
      startMarker,
    });
  }

  private stopVerifiedProxy(owner: ProxyOwner): void {
    if (!processMatchesOwner(owner, this.proxy)) {
      throw new Error(
        `Refusing to stop an unowned Portless proxy on port ${this.port}`
      );
    }
    if (!signalOwnerProcess(owner, "SIGTERM")) {
      return;
    }
    if (waitForOwnerProcessToStop(owner, GRACEFUL_PROXY_STOP_MS)) {
      return;
    }
    if (!signalOwnerProcess(owner, "SIGKILL")) {
      return;
    }
    if (!waitForOwnerProcessToStop(owner, FORCED_PROXY_STOP_MS)) {
      throw new Error(`Portless proxy on port ${this.port} did not stop`);
    }
  }
}
