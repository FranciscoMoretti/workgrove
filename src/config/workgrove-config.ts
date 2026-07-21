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
  cloneWorkgroveConfig,
  type WorkgroveAppGroup,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "./workgrove-schema";
import {
  type ResolvedTemplateApp,
  renderWorkgroveTemplate,
} from "./workgrove-template";

// biome-ignore lint/performance/noBarrelFile: preserve the package's internal config-module exports.
export {
  type WorkgroveApp,
  type WorkgroveAppGroup,
  WorkgroveAppGroupNameSchema,
  WorkgroveAppGroupSchema,
  WorkgroveAppIdSchema,
  WorkgroveAppSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  WorkgroveEnvironmentNameSchema,
  type WorktreeEnvConfig,
} from "./workgrove-schema";

export type ResolvedWorkgroveApp = ResolvedTemplateApp;

export interface ResolvedWorkgroveAppGroup {
  apps: Record<string, ResolvedWorkgroveApp>;
  id: string;
}

export type ResolvedWorkgroveAppGroups = Record<
  string,
  ResolvedWorkgroveAppGroup
>;

export interface ResolvedWorkgroveCommand {
  argv: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface WorkgroveConfigDocument {
  config: WorkgroveConfig;
  revision: string;
}

function group(config: WorkgroveConfig, groupId: string): WorkgroveAppGroup {
  const value = config.appGroups[groupId];
  if (!value) {
    throw new Error(`Unknown App group "${groupId}"`);
  }
  return value;
}

export function workgroveCommandEnvironment(
  config: WorkgroveConfig,
  groupId: string,
  appGroups: ResolvedWorkgroveAppGroups
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(group(config, groupId).env ?? {}).map(([name, template]) => [
      name,
      renderWorkgroveTemplate(template, {
        appGroups,
        currentGroup: groupId,
      }),
    ])
  );
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
  const result = WorkgroveConfigSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    throw new Error(
      `Invalid Workgrove config: ${z.prettifyError(result.error)}`
    );
  }
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
  const validated = WorkgroveConfigSchema.parse(cloneWorkgroveConfig(config));
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

function resolveCommand(
  config: WorkgroveConfig,
  groupId: string,
  command: WorkgroveCommand,
  appGroups: ResolvedWorkgroveAppGroups
): ResolvedWorkgroveCommand {
  const context = { appGroups, currentGroup: groupId };
  return {
    argv: command.argv.map((argument) =>
      renderWorkgroveTemplate(argument, context)
    ),
    ...(command.cwd ? { cwd: command.cwd } : {}),
    env: workgroveCommandEnvironment(config, groupId, appGroups),
  };
}

export function resolveStartCommand(
  config: WorkgroveConfig,
  groupId: string,
  appGroups: ResolvedWorkgroveAppGroups
): ResolvedWorkgroveCommand {
  return resolveCommand(
    config,
    groupId,
    group(config, groupId).start,
    appGroups
  );
}

export function resolveStopCommand(
  config: WorkgroveConfig,
  groupId: string,
  appGroups: ResolvedWorkgroveAppGroups
): ResolvedWorkgroveCommand | null {
  const stop = group(config, groupId).stop;
  return stop === "process"
    ? null
    : resolveCommand(config, groupId, stop, appGroups);
}

export function resolveSetupCommand(
  config: WorkgroveConfig
): ResolvedWorkgroveCommand {
  return {
    argv: [...config.setup.argv],
    ...(config.setup.cwd ? { cwd: config.setup.cwd } : {}),
    env: {},
  };
}
