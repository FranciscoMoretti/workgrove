import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  return Boolean(
    config.control?.start ||
      configuredSetupCommand(config) ||
      Object.values(config.apps).some((app) => app.start)
  );
}

export function repositoryIsTrusted(
  repoPath: string,
  config: WorkgroveConfig
): boolean {
  return !repositoryRequiresTrust(config) || Boolean(trustStore()[repoPath]);
}

export function trustRepository(repoPath: string): void {
  mkdirSync(CONTROL_DIR, { recursive: true });
  const temporary = `${TRUST_FILE}.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ ...trustStore(), [repoPath]: true }, null, 2)}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, TRUST_FILE);
}
