import { expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileWorkgroveStateStore } from "../src/runtime/local-state";
import {
  appGroupInstanceProcessId,
  ProcessSupervisor,
} from "../src/runtime/process-supervisor";
import {
  reserveBackingPort,
  waitForAppReadiness,
} from "../src/runtime/readiness";
import { assertProductionWorktreeAvailable } from "./production-run-preflight";

function recordProductionRun(
  productionControlDirectory: string,
  worktreePath: string,
  port: number,
  options: { listenerClaimed?: boolean } = {}
): { instanceId: string } {
  const state = new FileWorkgroveStateStore(
    join(productionControlDirectory, "state.json")
  );
  const instance = state.instance({
    groupId: "Chat",
    mode: "per-worktree",
    repoLabel: "chat-js",
    repoPath: worktreePath,
    worktreeLabel: "main",
    worktreePath,
  });
  state.endpoint({
    appId: "chat",
    appLabel: "chat",
    groupId: "Chat",
    instanceId: instance.id,
    repoPath: worktreePath,
  });
  state.assignEndpointPort(
    { instanceId: instance.id, repoPath: worktreePath },
    "chat",
    port
  );
  state.saveRun(
    { instanceId: instance.id, repoPath: worktreePath },
    {
      apps: {
        chat: {
          appId: "chat",
          directUrl: `http://127.0.0.1:${port}`,
          host: "127.0.0.1",
          ...(options.listenerClaimed ? { listenerClaimed: true } : {}),
          port,
          protocol: "http",
        },
      },
      createdAt: new Date().toISOString(),
      groupId: "Chat",
      instanceId: instance.id,
      instanceIdsByGroup: { Chat: instance.id },
      worktreePath,
    }
  );
  return { instanceId: instance.id };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await once(child, "exit");
}

it("rejects a worktree with a verified production run", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-production-preflight-")
  );
  const productionControlDirectory = join(temporary, "home", ".workgrove");
  const worktreePath = join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const processes = new ProcessSupervisor(productionControlDirectory);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  const { instanceId } = recordProductionRun(
    productionControlDirectory,
    canonicalWorktreePath,
    port
  );
  const processId = appGroupInstanceProcessId(instanceId);

  try {
    await portReservation.release();
    const pid = processes.startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
      ],
      cwd: canonicalWorktreePath,
      env: { PORT: String(port) },
      label: "Chat",
      ownerRoot: canonicalWorktreePath,
      processId,
    });
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production Workgrove already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${pid})`
    );
  } finally {
    await processes.stopManagedProcess(processId, canonicalWorktreePath);
    await portReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("rejects an orphaned listener that still belongs to the worktree", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-production-listener-preflight-")
  );
  const productionControlDirectory = join(temporary, "home", ".workgrove");
  const worktreePath = join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  recordProductionRun(productionControlDirectory, canonicalWorktreePath, port);
  await portReservation.release();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
    ],
    {
      cwd: canonicalWorktreePath,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    }
  );

  try {
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production Workgrove already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${child.pid})`
    );
  } finally {
    await stopChild(child);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("rejects a claimed command-managed listener outside the worktree", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-production-command-listener-preflight-")
  );
  const productionControlDirectory = join(temporary, "home", ".workgrove");
  const worktreePath = join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  recordProductionRun(productionControlDirectory, canonicalWorktreePath, port, {
    listenerClaimed: true,
  });
  await portReservation.release();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
    ],
    {
      cwd: temporary,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    }
  );

  try {
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production Workgrove already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${child.pid})`
    );
  } finally {
    await stopChild(child);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("ignores stale production state without a live process or listener", async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-production-stale-preflight-")
  );
  const productionControlDirectory = join(temporary, "home", ".workgrove");
  const worktreePath = join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();
  let portReleased = false;

  try {
    recordProductionRun(
      productionControlDirectory,
      canonicalWorktreePath,
      portReservation.port
    );
    await portReservation.release();
    portReleased = true;

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).not.toThrow();
  } finally {
    if (!portReleased) {
      await portReservation.release();
    }
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("fails closed when production state cannot be verified", () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "workgrove-production-invalid-preflight-")
  );
  const productionControlDirectory = join(temporary, "home", ".workgrove");
  const worktreePath = join(temporary, "project");
  mkdirSync(productionControlDirectory, { recursive: true });
  mkdirSync(worktreePath);
  writeFileSync(join(productionControlDirectory, "state.json"), "not-json\n");

  try {
    expect(() =>
      assertProductionWorktreeAvailable(worktreePath, {
        productionControlDirectory,
      })
    ).toThrow("Could not verify Production Workgrove state");
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
