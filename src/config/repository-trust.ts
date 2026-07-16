import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkgroveCommand } from "./workgrove-command";
import type { WorkgroveConfig } from "./workgrove-config";

const CONTROL_DIR = join(homedir(), ".workgrove");
const TRUST_FILE = join(CONTROL_DIR, "trusted-repositories.json");

function trustStore(): Record<string, boolean | string> {
  if (!existsSync(TRUST_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(TRUST_FILE, "utf8")) as Record<
      string,
      boolean | string
    >;
  } catch {
    return {};
  }
}

export function repositoryRequiresTrust(_config: WorkgroveConfig): boolean {
  return true;
}

function fingerprintCommand(command: WorkgroveCommand) {
  return { argv: command.argv };
}

export function repositoryCommandFingerprint(config: WorkgroveConfig): string {
  const commands = {
    environment: {
      apps: config.apps,
      env: config.env ?? {},
      stride: config.stride,
    },
    setup: fingerprintCommand(config.setup),
    start: fingerprintCommand(config.start),
  };
  return createHash("sha256")
    .update(JSON.stringify(commands))
    .digest("base64url");
}

export function repositoryIsTrusted(
  repoPath: string,
  config: WorkgroveConfig
): boolean {
  return (
    !repositoryRequiresTrust(config) ||
    trustStore()[repoPath] === repositoryCommandFingerprint(config)
  );
}

export function trustRepository(
  repoPath: string,
  config: WorkgroveConfig
): void {
  mkdirSync(CONTROL_DIR, { recursive: true });
  const temporary = `${TRUST_FILE}.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      { ...trustStore(), [repoPath]: repositoryCommandFingerprint(config) },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, TRUST_FILE);
}
