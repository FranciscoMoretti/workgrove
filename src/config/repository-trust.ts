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
import { z } from "zod";
import type { WorkgroveCommand } from "./workgrove-command";
import type { WorkgroveConfig } from "./workgrove-config";

function defaultControlDirectory(): string {
  return process.env.WORKGROVE_CONTROL_DIR ?? join(homedir(), ".workgrove");
}

function trustFile(controlDirectory = defaultControlDirectory()): string {
  return join(controlDirectory, "trusted-repositories.json");
}

const TrustStoreSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.string()])
);

function trustStore(
  controlDirectory?: string
): Record<string, boolean | string> {
  const file = trustFile(controlDirectory);
  if (!existsSync(file)) {
    return {};
  }
  try {
    return TrustStoreSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

export function repositoryRequiresTrust(_config: WorkgroveConfig): boolean {
  return true;
}

function fingerprintCommand(command: WorkgroveCommand) {
  return { argv: command.argv, ...(command.cwd ? { cwd: command.cwd } : {}) };
}

export function repositoryCommandFingerprint(config: WorkgroveConfig): string {
  const commands = {
    appGroups: Object.fromEntries(
      Object.entries(config.appGroups).map(([name, group]) => [
        name,
        {
          apps: group.apps,
          env: group.env ?? {},
          instances: group.instances,
          start: fingerprintCommand(group.start),
          stop:
            group.stop === "process"
              ? "process"
              : fingerprintCommand(group.stop),
        },
      ])
    ),
    setup: fingerprintCommand(config.setup),
  };
  return createHash("sha256")
    .update(JSON.stringify(commands))
    .digest("base64url");
}

export function repositoryIsTrusted(
  repoPath: string,
  config: WorkgroveConfig,
  controlDirectory?: string
): boolean {
  return (
    !repositoryRequiresTrust(config) ||
    trustStore(controlDirectory)[repoPath] ===
      repositoryCommandFingerprint(config)
  );
}

export function trustRepository(
  repoPath: string,
  config: WorkgroveConfig,
  controlDirectory?: string
): void {
  const directory = controlDirectory ?? defaultControlDirectory();
  const file = trustFile(directory);
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        ...trustStore(directory),
        [repoPath]: repositoryCommandFingerprint(config),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, file);
}
