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
import {
  configuredSetupCommand,
  type WorkgroveConfig,
} from "./workgrove-config";

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

export function repositoryRequiresTrust(config: WorkgroveConfig): boolean {
  return Boolean(config.start || configuredSetupCommand(config));
}

function fingerprintCommand(command: WorkgroveCommand | null) {
  return command
    ? {
        argv: command.argv,
      }
    : null;
}

export function repositoryCommandFingerprint(config: WorkgroveConfig): string {
  const commands = {
    setup: fingerprintCommand(configuredSetupCommand(config)),
    start: fingerprintCommand(config.start ?? null),
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
