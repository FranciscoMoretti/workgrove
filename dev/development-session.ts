import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";
import { CodexHookActivityStore } from "../src/codex/codex-hook-activity";
import type { WorkspaceControllerRuntimeOptions } from "../src/controller/workspace-controller";
import { processStartMarker } from "../src/host/process-inspection";
import { FileWorkgroveStateStore } from "../src/runtime/local-state";
import { ProcessSupervisor } from "../src/runtime/process-supervisor";
import { reserveBackingPort } from "../src/runtime/readiness";
import {
  DevelopmentProxyPortConflictError,
  DevelopmentRouting,
} from "./development-routing";
import {
  acquireExclusiveFileLock,
  ExclusiveFileLockBusyError,
} from "./exclusive-file-lock";

const DEFAULT_PORTLESS_PORT = 1355;

const DevelopmentOwnerSchema = z.strictObject({
  pid: z.number().int().positive(),
  startMarker: z.string().min(1).max(256),
  token: z.string().min(1),
});
type DevelopmentOwner = z.infer<typeof DevelopmentOwnerSchema>;

export interface DevelopmentSessionProfile {
  codexControlDirectory: string;
  controlDirectory: string;
  dashboardPort: number;
  portlessPort: number;
  portlessStateDirectory: string;
  statePath: string;
}

export interface DevelopmentSession {
  close(): void;
  controllerRuntime: WorkspaceControllerRuntimeOptions;
  profile: DevelopmentSessionProfile;
}

interface OpenDevelopmentSessionOptions {
  appRoot: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

function configuredPort(
  value: string | undefined,
  fallback: number,
  label: string,
  allowZero = false
): number {
  if (value === undefined) {
    return fallback;
  }
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!(Number.isInteger(port) && port >= minimum && port <= 65_535)) {
    throw new Error(`${label} must be an integer between ${minimum} and 65535`);
  }
  return port;
}

function developmentProfileId(appRoot: string): string {
  return createHash("sha256")
    .update(realpathSync(appRoot))
    .digest("hex")
    .slice(0, 16);
}

function readOwner(file: string): DevelopmentOwner | null {
  try {
    return DevelopmentOwnerSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function acquireDevelopmentOwnership(controlDirectory: string): () => void {
  mkdirSync(controlDirectory, { mode: 0o700, recursive: true });
  const file = join(controlDirectory, "server.lock");
  const temporary = join(
    controlDirectory,
    `.server.lock.${process.pid}.${randomUUID()}.tmp`
  );
  const startMarker = processStartMarker(process.pid);
  if (!startMarker) {
    throw new Error("Could not identify the Workgrove development process");
  }
  const owner: DevelopmentOwner = {
    pid: process.pid,
    startMarker,
    token: randomUUID(),
  };
  let releaseGuard: () => void;
  try {
    releaseGuard = acquireExclusiveFileLock(
      join(controlDirectory, "server.lock.guard.sqlite")
    );
  } catch (error) {
    if (error instanceof ExclusiveFileLockBusyError) {
      const current = readOwner(file);
      throw new Error(
        current
          ? `Workgrove development is already running for this checkout (pid ${current.pid})`
          : "Workgrove development is already running for this checkout"
      );
    }
    throw error;
  }
  try {
    writeFileSync(temporary, `${JSON.stringify(owner)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    rmSync(file, { force: true });
    linkSync(temporary, file);
  } catch (error) {
    releaseGuard();
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
  return () => {
    try {
      const current = readOwner(file);
      if (
        current?.pid === owner.pid &&
        current.startMarker === owner.startMarker &&
        current.token === owner.token
      ) {
        rmSync(file, { force: true });
      }
    } finally {
      releaseGuard();
    }
  };
}

async function prepareDevelopmentRouting(
  stateDirectory: string,
  port: number
): Promise<DevelopmentRouting> {
  const routing = new DevelopmentRouting({ port, stateDirectory });
  try {
    await routing.prepare();
    return routing;
  } catch (error) {
    try {
      routing.stopOwnedProxy();
    } catch {
      // No verified session-owned proxy is stopped after failed preparation.
    }
    throw error;
  }
}

async function openDevelopmentRouting(
  stateDirectory: string,
  configuredPortValue: string | undefined
): Promise<DevelopmentRouting> {
  const survivingProxyPort = DevelopmentRouting.ownedProxyPort(stateDirectory);
  if (configuredPortValue !== undefined) {
    const requestedPort = configuredPort(
      configuredPortValue,
      DEFAULT_PORTLESS_PORT,
      "WORKGROVE_PORTLESS_PORT"
    );
    if (survivingProxyPort !== null && survivingProxyPort !== requestedPort) {
      new DevelopmentRouting({
        port: survivingProxyPort,
        stateDirectory,
      }).stopOwnedProxy();
    }
    return prepareDevelopmentRouting(stateDirectory, requestedPort);
  }
  if (survivingProxyPort !== null) {
    try {
      return await prepareDevelopmentRouting(
        stateDirectory,
        survivingProxyPort
      );
    } catch {
      // Allocate a new owned proxy after verified recovery fails.
    }
  }
  let lastConflict: DevelopmentProxyPortConflictError | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reservation = await reserveBackingPort();
    const port = reservation.port;
    await reservation.release();
    try {
      return await prepareDevelopmentRouting(stateDirectory, port);
    } catch (error) {
      if (!(error instanceof DevelopmentProxyPortConflictError)) {
        throw error;
      }
      lastConflict = error;
    }
  }
  throw (
    lastConflict ??
    new Error("Could not allocate a Portless port for Workgrove development")
  );
}

export async function openDevelopmentSession(
  options: OpenDevelopmentSessionOptions
): Promise<DevelopmentSession> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const controlDirectory = join(
    homeDirectory,
    ".workgrove",
    "development",
    developmentProfileId(options.appRoot)
  );
  const statePath = join(controlDirectory, "state.json");
  const portlessStateDirectory = join(controlDirectory, "portless");
  const codexControlDirectory = join(controlDirectory, "codex");
  const dashboardPort = configuredPort(
    environment.WORKGROVE_PORT,
    0,
    "WORKGROVE_PORT",
    true
  );
  const releaseOwnership = acquireDevelopmentOwnership(controlDirectory);
  let routing: DevelopmentRouting | undefined;

  try {
    routing = await openDevelopmentRouting(
      portlessStateDirectory,
      environment.WORKGROVE_PORTLESS_PORT
    );
    const profile: DevelopmentSessionProfile = {
      codexControlDirectory,
      controlDirectory,
      dashboardPort,
      portlessPort: routing.port,
      portlessStateDirectory,
      statePath,
    };
    let closed = false;
    return {
      close() {
        if (closed) {
          return;
        }
        closed = true;
        try {
          try {
            routing?.stopOwnedProxy();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `Could not stop the Workgrove development proxy: ${message}`
            );
          }
        } finally {
          releaseOwnership();
        }
      },
      controllerRuntime: {
        codexHooks: new CodexHookActivityStore({
          file: join(codexControlDirectory, "activity.json"),
        }),
        processes: new ProcessSupervisor(controlDirectory),
        routing,
        state: new FileWorkgroveStateStore(statePath),
      },
      profile,
    };
  } catch (error) {
    releaseOwnership();
    throw error;
  }
}
