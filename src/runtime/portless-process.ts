import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { processIsLive } from "../host/process-inspection";

const require = createRequire(import.meta.url);

function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function numberFile(path: string): number | null {
  if (!existsSync(path)) {
    return null;
  }
  const value = Number(readFileSync(path, "utf8").trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export class PortlessProcess {
  private readonly cliPath: string;
  private readonly nodePath: string;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: {
    nodePath?: string;
    port: number;
    stateDirectory: string;
  }) {
    this.cliPath = packageFile("portless", "dist", "cli.js");
    this.nodePath = options.nodePath ?? packageFile("node", "bin", "node");
    this.port = options.port;
    this.stateDirectory = options.stateDirectory;
  }

  isLive(): boolean {
    const pid = this.pid();
    return pid !== null && processIsLive(pid);
  }

  pid(): number | null {
    return numberFile(join(this.stateDirectory, "proxy.pid"));
  }

  recordedPort(): number | null {
    const port = numberFile(join(this.stateDirectory, "proxy.port"));
    return port !== null && port <= 65_535 ? port : null;
  }

  run(args: string[]): void {
    const result = spawnSync(this.nodePath, [this.cliPath, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PORTLESS_HTTPS: "0",
        PORTLESS_PORT: String(this.port),
        PORTLESS_STATE_DIR: this.stateDirectory,
        PORTLESS_SYNC_HOSTS: "0",
        PORTLESS_TLD: "localhost",
      },
      timeout: 10_000,
    });
    if (result.error) {
      throw new Error(`Could not run Portless: ${result.error.message}`, {
        cause: result.error,
      });
    }
    if (result.status !== 0) {
      const fallback = result.signal
        ? `Portless command failed with signal ${result.signal}`
        : `Portless command failed with exit status ${result.status ?? "unknown"}`;
      throw new Error((result.stderr || result.stdout || fallback).trim());
    }
  }
}
