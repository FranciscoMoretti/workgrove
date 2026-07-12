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

import type { WorkgroveConfig } from "./workgrove-config";

const CONTROL_DIR = join(homedir(), ".workgrove");
const TRUST_FILE = join(CONTROL_DIR, "trusted-repositories.json");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

function trustStore(): Record<string, string> {
  if (!existsSync(TRUST_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(TRUST_FILE, "utf8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

export function repositoryFingerprint(config: WorkgroveConfig): string {
  const { $schema: _schema, ...executionConfig } = config;
  return createHash("sha256")
    .update(JSON.stringify(canonical(executionConfig)))
    .digest("hex");
}

export function repositoryRequiresTrust(config: WorkgroveConfig): boolean {
  return Boolean(
    config.control?.start ||
      config.control?.postCreate ||
      Object.values(config.apps).some((app) => app.start)
  );
}

export function repositoryIsTrusted(
  repoPath: string,
  config: WorkgroveConfig
): boolean {
  return (
    !repositoryRequiresTrust(config) ||
    trustStore()[repoPath] === repositoryFingerprint(config)
  );
}

export function trustRepositoryConfig(
  repoPath: string,
  config: WorkgroveConfig
): string {
  mkdirSync(CONTROL_DIR, { recursive: true });
  const fingerprint = repositoryFingerprint(config);
  const temporary = `${TRUST_FILE}.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ ...trustStore(), [repoPath]: fingerprint }, null, 2)}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, TRUST_FILE);
  return fingerprint;
}
