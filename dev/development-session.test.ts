import { expect, it, spyOn } from "bun:test";
import {
  existsSync,
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

import { reserveBackingPort } from "../src/runtime/readiness";
import { DevelopmentRouting } from "./development-routing";
import { openDevelopmentSession } from "./development-session";

it("isolates development resources from the production runtime", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-development-"));
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const proxyPort = await reserveBackingPort();
  const expectedProductionDirectory = join(homeDirectory, ".workgrove");
  const productionState = join(expectedProductionDirectory, "state.json");
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    mkdirSync(expectedProductionDirectory, { recursive: true });
    writeFileSync(productionState, "production-state\n");
    const port = proxyPort.port;
    await proxyPort.release();
    opened = await openDevelopmentSession({
      appRoot,
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
    opened?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("allows only one development writer per checkout", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-development-lock-"));
  const proxyPort = await reserveBackingPort();
  const port = proxyPort.port;
  let first: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let reopened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  const options = {
    appRoot: realpathSync("."),
    environment: { WORKGROVE_PORTLESS_PORT: String(port) },
    homeDirectory: join(temporary, "home"),
  };

  try {
    await proxyPort.release();
    first = await openDevelopmentSession(options);
    await expect(openDevelopmentSession(options)).rejects.toThrow(
      "Workgrove development is already running for this checkout"
    );
    expect(
      readdirSync(first.profile.controlDirectory).filter((entry) =>
        entry.startsWith(".server.lock.")
      )
    ).toEqual([]);

    const ownershipFile = join(first.profile.controlDirectory, "server.lock");
    first.close();
    first = undefined;
    writeFileSync(
      ownershipFile,
      `${JSON.stringify({
        pid: 2_147_483_647,
        startMarker: "stale",
        token: "stale",
      })}\n`
    );
    reopened = await openDevelopmentSession(options);
    expect(reopened.profile.portlessPort).toBe(port);
  } finally {
    reopened?.close();
    first?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects an empty explicit development proxy port", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-development-empty-port-")
  );

  try {
    await expect(
      openDevelopmentSession({
        appRoot: realpathSync("."),
        environment: { WORKGROVE_PORTLESS_PORT: "" },
        homeDirectory: join(temporary, "home"),
      })
    ).rejects.toThrow(
      "WORKGROVE_PORTLESS_PORT must be an integer between 1 and 65535"
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("releases session ownership when proxy shutdown fails", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-development-close-"));
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let stopProxy: (() => void) | undefined;

  try {
    opened = await openDevelopmentSession({
      appRoot: realpathSync("."),
      environment: {},
      homeDirectory: join(temporary, "home"),
    });
    const routing = opened.controllerRuntime.routing as DevelopmentRouting;
    stopProxy = routing.stopOwnedProxy.bind(routing);
    routing.stopOwnedProxy = () => {
      throw new Error("simulated shutdown failure");
    };
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() => opened?.close()).not.toThrow();
    } finally {
      warning.mockRestore();
    }
    expect(
      existsSync(join(opened.profile.controlDirectory, "server.lock"))
    ).toBe(false);
    stopProxy();
    stopProxy = undefined;
    opened = undefined;
  } finally {
    try {
      stopProxy?.();
    } catch {
      // Best-effort cleanup for an assertion failure.
    }
    opened?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("opens different development checkouts concurrently", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-development-checkouts-")
  );
  const firstRoot = join(temporary, "first");
  const secondRoot = join(temporary, "second");
  const homeDirectory = join(temporary, "home");
  let first: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let second: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    first = await openDevelopmentSession({
      appRoot: firstRoot,
      environment: {},
      homeDirectory,
    });
    second = await openDevelopmentSession({
      appRoot: secondRoot,
      environment: {},
      homeDirectory,
    });

    expect(first.profile.controlDirectory).not.toBe(
      second.profile.controlDirectory
    );
    expect(first.profile.portlessPort).not.toBe(second.profile.portlessPort);
  } finally {
    second?.close();
    first?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("reuses a surviving development proxy after a server crash", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-development-recovery-")
  );
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const reservation = await reserveBackingPort();
  const survivingPort = reservation.port;
  let initial: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let recovered: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let survivingProxy: DevelopmentRouting | undefined;

  try {
    await reservation.release();
    initial = await openDevelopmentSession({
      appRoot,
      environment: { WORKGROVE_PORTLESS_PORT: String(survivingPort) },
      homeDirectory,
    });
    const stateDirectory = initial.profile.portlessStateDirectory;
    initial.close();
    initial = undefined;

    survivingProxy = new DevelopmentRouting({
      port: survivingPort,
      stateDirectory,
    });
    await survivingProxy.prepare();
    recovered = await openDevelopmentSession({
      appRoot,
      environment: {},
      homeDirectory,
    });

    expect(recovered.profile.portlessPort).toBe(survivingPort);
  } finally {
    recovered?.close();
    try {
      survivingProxy?.stopOwnedProxy();
    } catch {
      // The recovered session normally stopped the surviving proxy.
    }
    initial?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects an occupied explicit development proxy port", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-development-conflict-")
  );
  const reservation = await reserveBackingPort();
  const options = {
    appRoot: realpathSync("."),
    environment: {
      WORKGROVE_PORTLESS_PORT: String(reservation.port),
    },
    homeDirectory: join(temporary, "home"),
  };
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    await expect(openDevelopmentSession(options)).rejects.toThrow(
      `Portless proxy port ${reservation.port} is already in use`
    );
    await reservation.release();
    opened = await openDevelopmentSession({
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
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-development-override-")
  );
  const homeDirectory = join(temporary, "home");
  const appRoot = realpathSync(".");
  const firstReservation = await reserveBackingPort();
  const secondReservation = await reserveBackingPort(
    new Set([firstReservation.port])
  );
  let initial: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let replaced: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let survivingProxy: DevelopmentRouting | undefined;

  try {
    await firstReservation.release();
    initial = await openDevelopmentSession({
      appRoot,
      environment: {
        WORKGROVE_PORTLESS_PORT: String(firstReservation.port),
      },
      homeDirectory,
    });
    const stateDirectory = initial.profile.portlessStateDirectory;
    initial.close();
    initial = undefined;

    survivingProxy = new DevelopmentRouting({
      port: firstReservation.port,
      stateDirectory,
    });
    await survivingProxy.prepare();
    await secondReservation.release();
    replaced = await openDevelopmentSession({
      appRoot,
      environment: {
        WORKGROVE_PORTLESS_PORT: String(secondReservation.port),
      },
      homeDirectory,
    });

    expect(replaced.profile.portlessPort).toBe(secondReservation.port);
    expect(DevelopmentRouting.ownedProxyPort(stateDirectory)).toBe(
      secondReservation.port
    );
  } finally {
    replaced?.close();
    try {
      survivingProxy?.stopOwnedProxy();
    } catch {
      // The replacement session normally stopped the surviving proxy.
    }
    initial?.close();
    await secondReservation.release();
    await firstReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});
