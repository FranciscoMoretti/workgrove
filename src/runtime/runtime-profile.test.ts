import { expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PortlessRoutingEngine } from "./local-routing";
import { reserveBackingPort } from "./readiness";
import { openRuntimeProfile } from "./runtime-profile";

it("isolates development resources from the production profile", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-"));
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const proxyPort = await reserveBackingPort();
  const expectedProductionDirectory = join(homeDirectory, ".workgrove");
  const productionState = join(expectedProductionDirectory, "state.json");
  let opened: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;

  try {
    mkdirSync(expectedProductionDirectory, { recursive: true });
    writeFileSync(productionState, "production-state\n");
    const port = proxyPort.port;
    await proxyPort.release();
    opened = await openRuntimeProfile({
      appRoot,
      development: true,
      environment: {
        WORKGROVE_CODEX_CONTROL_DIR: join(expectedProductionDirectory, "codex"),
        WORKGROVE_PORTLESS_PORT: String(port),
      },
      homeDirectory,
    });

    expect(opened.profile.controlDirectory).toStartWith(
      join(expectedProductionDirectory, "development")
    );
    expect(opened.profile.controlDirectory).not.toBe(
      expectedProductionDirectory
    );
    expect(opened.profile.statePath).toBe(
      join(opened.profile.controlDirectory, "state.json")
    );
    expect(opened.profile.portlessStateDirectory).toBe(
      join(opened.profile.controlDirectory, "portless")
    );
    expect(opened.profile.codexControlDirectory).toBe(
      join(opened.profile.controlDirectory, "codex")
    );
    expect(opened.profile.dashboardPort).toBe(0);
    expect(opened.profile.portlessPort).toBe(port);
    expect(readFileSync(productionState, "utf8")).toBe("production-state\n");
  } finally {
    await opened?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("allows only one development writer per checkout", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-lock-"));
  const proxyPort = await reserveBackingPort();
  const port = proxyPort.port;
  let first: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let reopened: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  const options = {
    appRoot: realpathSync("."),
    development: true,
    environment: { WORKGROVE_PORTLESS_PORT: String(port) },
    homeDirectory: join(temporary, "home"),
  };

  try {
    await proxyPort.release();
    first = await openRuntimeProfile(options);
    await expect(openRuntimeProfile(options)).rejects.toThrow(
      "Workgrove development is already running for this checkout"
    );
    expect(
      readdirSync(first.profile.controlDirectory).filter((entry) =>
        entry.startsWith(".server.lock.")
      )
    ).toEqual([]);

    const ownershipFile = join(first.profile.controlDirectory, "server.lock");
    await first.close();
    first = undefined;
    writeFileSync(
      ownershipFile,
      `${JSON.stringify({
        pid: 2_147_483_647,
        startMarker: "stale",
        token: "stale",
      })}\n`
    );
    reopened = await openRuntimeProfile(options);
    expect(reopened.profile.portlessPort).toBe(port);
  } finally {
    await reopened?.close();
    await first?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("preserves the production profile defaults", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-profile-production-")
  );
  const homeDirectory = join(temporary, "home");
  const opened = await openRuntimeProfile({
    appRoot: realpathSync("."),
    development: false,
    environment: {},
    homeDirectory,
  });

  try {
    const controlDirectory = join(homeDirectory, ".workgrove");
    expect(opened.profile).toMatchObject({
      codexControlDirectory: join(controlDirectory, "codex"),
      controlDirectory,
      dashboardPort: 3999,
      development: false,
      portlessPort: 1355,
      portlessStateDirectory: join(controlDirectory, "portless"),
      statePath: join(controlDirectory, "state.json"),
    });
  } finally {
    await opened.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("opens different development checkouts concurrently", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-checkouts-"));
  const firstRoot = join(temporary, "first");
  const secondRoot = join(temporary, "second");
  const homeDirectory = join(temporary, "home");
  let first: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let second: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;

  try {
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    first = await openRuntimeProfile({
      appRoot: firstRoot,
      development: true,
      environment: {},
      homeDirectory,
    });
    second = await openRuntimeProfile({
      appRoot: secondRoot,
      development: true,
      environment: {},
      homeDirectory,
    });

    expect(first.profile.controlDirectory).not.toBe(
      second.profile.controlDirectory
    );
    expect(first.profile.portlessPort).not.toBe(second.profile.portlessPort);
  } finally {
    await second?.close();
    await first?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("reuses a surviving development proxy after a server crash", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-recovery-"));
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const reservation = await reserveBackingPort();
  const survivingPort = reservation.port;
  let initial: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let recovered: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let survivingProxy: PortlessRoutingEngine | undefined;

  try {
    await reservation.release();
    initial = await openRuntimeProfile({
      appRoot,
      development: true,
      environment: { WORKGROVE_PORTLESS_PORT: String(survivingPort) },
      homeDirectory,
    });
    const stateDirectory = initial.profile.portlessStateDirectory;
    await initial.close();
    initial = undefined;

    survivingProxy = new PortlessRoutingEngine({
      exclusiveOwnership: true,
      port: survivingPort,
      stateDirectory,
    });
    await survivingProxy.prepare();
    recovered = await openRuntimeProfile({
      appRoot,
      development: true,
      environment: {},
      homeDirectory,
    });

    expect(recovered.profile.portlessPort).toBe(survivingPort);
  } finally {
    await recovered?.close();
    survivingProxy?.stopProxy();
    await initial?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects an occupied explicit development proxy port", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-conflict-"));
  const reservation = await reserveBackingPort();
  const options = {
    appRoot: realpathSync("."),
    development: true,
    environment: {
      WORKGROVE_PORTLESS_PORT: String(reservation.port),
    },
    homeDirectory: join(temporary, "home"),
  };
  let opened: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;

  try {
    await expect(openRuntimeProfile(options)).rejects.toThrow(
      `Portless proxy port ${reservation.port} is already in use`
    );
    await reservation.release();
    opened = await openRuntimeProfile({
      ...options,
      environment: {},
    });
    expect(opened.profile.portlessPort).not.toBe(reservation.port);
  } finally {
    opened?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("replaces a surviving proxy when an explicit port changes", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-profile-override-"));
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const firstReservation = await reserveBackingPort();
  const secondReservation = await reserveBackingPort(
    new Set([firstReservation.port])
  );
  let initial: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let replaced: Awaited<ReturnType<typeof openRuntimeProfile>> | undefined;
  let survivingProxy: PortlessRoutingEngine | undefined;

  try {
    await firstReservation.release();
    initial = await openRuntimeProfile({
      appRoot,
      development: true,
      environment: {
        WORKGROVE_PORTLESS_PORT: String(firstReservation.port),
      },
      homeDirectory,
    });
    const stateDirectory = initial.profile.portlessStateDirectory;
    initial.close();
    initial = undefined;

    survivingProxy = new PortlessRoutingEngine({
      exclusiveOwnership: true,
      port: firstReservation.port,
      stateDirectory,
    });
    await survivingProxy.prepare();
    await secondReservation.release();
    replaced = await openRuntimeProfile({
      appRoot,
      development: true,
      environment: {
        WORKGROVE_PORTLESS_PORT: String(secondReservation.port),
      },
      homeDirectory,
    });

    expect(replaced.profile.portlessPort).toBe(secondReservation.port);
    expect(PortlessRoutingEngine.ownedProxyPort(stateDirectory)).toBe(
      secondReservation.port
    );
  } finally {
    replaced?.close();
    survivingProxy?.stopProxy();
    initial?.close();
    await secondReservation.release();
    await firstReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});
