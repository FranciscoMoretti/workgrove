import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import type { WorkgroveCommand } from "./workgrove-command";
import {
  canonicalizeWorkgroveConfig,
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  WORKGROVE_DEFAULT_SLOT,
  WORKGROVE_SLOT_ENV,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  workgroveAppPortEnvironmentName,
} from "./workgrove-schema";
import { renderWorkgroveTemplate } from "./workgrove-template";

// biome-ignore lint/performance/noBarrelFile: preserve the package's internal config-module exports.
export {
  maximumWorkgroveSlot,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  WorkgroveAppIdSchema,
  WorkgroveAppSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  type WorktreeEnvConfig,
  workgroveAppPortEnvironmentName,
} from "./workgrove-schema";

const SLOT_PATTERN = /^\d+$/;

export interface ResolvedWorkgroveApp {
  port: number;
  url: string;
}

export interface ResolvedWorkgroveRuntime {
  apps: Record<string, ResolvedWorkgroveApp>;
  slot: number;
}

export interface ResolvedWorkgroveCommand {
  argv: string[];
  env: Record<string, string>;
}

export interface WorkgroveConfigDocument {
  config: WorkgroveConfig;
  revision: string;
}

export function resolveWorkgroveRuntime(
  config: WorkgroveConfig,
  environment: Record<string, string | undefined>
): ResolvedWorkgroveRuntime {
  WorkgroveConfigSchema.parse(config);
  const rawSlot =
    environment[WORKGROVE_SLOT_ENV] ?? String(WORKGROVE_DEFAULT_SLOT);
  if (!SLOT_PATTERN.test(rawSlot)) {
    throw new Error(`Invalid ${WORKGROVE_SLOT_ENV} "${rawSlot}"`);
  }
  const slot = Number(rawSlot);
  const apps = Object.fromEntries(
    Object.entries(config.apps).map(([id, app]) => {
      const port = resolveWorkgroveAppPort(app, slot);
      if (port < MIN_WORKGROVE_PORT || port > MAX_WORKGROVE_PORT) {
        throw new Error(`App "${id}" computed invalid port ${port}`);
      }
      return [id, { port, url: `http://localhost:${port}` }];
    })
  );
  return { apps, slot };
}

export function workgroveCommandEnvironment(
  config: WorkgroveConfig,
  slot: number
): Record<string, string> {
  const runtime = resolveWorkgroveRuntime(config, {
    [WORKGROVE_SLOT_ENV]: String(slot),
  });
  return {
    [WORKGROVE_SLOT_ENV]: String(slot),
    ...Object.fromEntries(
      Object.entries(runtime.apps).map(([id, app]) => [
        workgroveAppPortEnvironmentName(id),
        String(app.port),
      ])
    ),
  };
}

export function findWorkgroveConfig(root: string): string | null {
  const path = join(root, ".workgrove.json");
  return existsSync(path) ? path : null;
}

function contentRevision(content: string): string {
  return createHash("sha256").update(content).digest("base64url");
}

export function loadWorkgroveConfigDocument(
  path: string
): WorkgroveConfigDocument {
  const content = readFileSync(path, "utf8");
  const raw = JSON.parse(content) as Record<string, unknown>;
  const candidate = raw.version === undefined ? { ...raw, version: 1 } : raw;
  const result = WorkgroveConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `Invalid Workgrove config: ${z.prettifyError(result.error)}`
    );
  }
  resolveWorkgroveRuntime(result.data, {});
  return { config: result.data, revision: contentRevision(content) };
}

export function loadWorkgroveConfig(path: string): WorkgroveConfig {
  return loadWorkgroveConfigDocument(path).config;
}

export function updateWorkgroveConfig(
  configPath: string,
  config: WorkgroveConfig,
  expectedRevision: string
): WorkgroveConfigDocument {
  const currentContent = readFileSync(configPath, "utf8");
  if (contentRevision(currentContent) !== expectedRevision) {
    throw new Error(
      "The configuration changed on disk. Reload it before saving your changes."
    );
  }
  const validated = WorkgroveConfigSchema.parse(
    canonicalizeWorkgroveConfig(config)
  );
  resolveWorkgroveRuntime(validated, {});
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, { flag: "wx" });
  try {
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return { config: validated, revision: contentRevision(content) };
}

export const resolveWorktreeRuntime = resolveWorkgroveRuntime;

export function configuredSetupCommand(
  config: WorkgroveConfig
): WorkgroveCommand | null {
  return config.setup ?? null;
}

function resolveCommand(
  config: WorkgroveConfig,
  command: WorkgroveCommand | undefined,
  slot: number
): ResolvedWorkgroveCommand | null {
  if (!command) {
    return null;
  }
  const runtime = resolveWorkgroveRuntime(config, {
    [WORKGROVE_SLOT_ENV]: String(slot),
  });
  const first = Object.values(runtime.apps)[0];
  return {
    argv: command.argv.map((value) =>
      renderWorkgroveTemplate(value, {
        apps: runtime.apps,
        port: first.port,
        slot,
        url: first.url,
      })
    ),
    env: workgroveCommandEnvironment(config, slot),
  };
}

export function resolveStartCommand(
  config: WorkgroveConfig,
  slot: number
): ResolvedWorkgroveCommand | null {
  return resolveCommand(config, config.start, slot);
}

export function resolveSetupCommand(
  config: WorkgroveConfig,
  slot: number
): ResolvedWorkgroveCommand | null {
  return resolveCommand(config, config.setup, slot);
}
