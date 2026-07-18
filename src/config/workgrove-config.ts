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
import {
  defaultWorkgroveSetupCommand,
  defaultWorkgroveStartCommand,
  type WorkgroveCommand,
} from "./workgrove-command";
import {
  cloneWorkgroveConfig,
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  resolveWorkgroveAppPort,
  type WorkgroveAppGroup,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "./workgrove-schema";
import { renderWorkgroveTemplate } from "./workgrove-template";

// biome-ignore lint/performance/noBarrelFile: preserve the package's internal config-module exports.
export {
  maximumWorkgroveAppGroupSlot,
  maximumWorkgroveSlot,
  resolveWorkgroveAppPort,
  type WorkgroveApp,
  type WorkgroveAppGroup,
  WorkgroveAppGroupNameSchema,
  WorkgroveAppGroupSchema,
  WorkgroveAppIdSchema,
  WorkgroveAppSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  type WorktreeEnvConfig,
} from "./workgrove-schema";

export interface ResolvedWorkgroveApp {
  port: number;
  url: string;
}

export interface ResolvedWorkgroveAppGroup {
  apps: Record<string, ResolvedWorkgroveApp>;
  name: string;
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

export type WorkgroveSlotAssignments = Record<string, number>;

function group(config: WorkgroveConfig, groupName: string): WorkgroveAppGroup {
  const value = config.appGroups[groupName];
  if (!value) {
    throw new Error(`Unknown App group "${groupName}"`);
  }
  return value;
}

export function defaultWorkgroveSlots(
  config: WorkgroveConfig
): WorkgroveSlotAssignments {
  return Object.fromEntries(
    Object.entries(config.appGroups).map(([name, value]) => [
      name,
      value.slot.default,
    ])
  );
}

export function resolveWorkgroveAppGroup(
  config: WorkgroveConfig,
  groupName: string,
  slot: number
): ResolvedWorkgroveAppGroup {
  WorkgroveConfigSchema.parse(config);
  if (!(Number.isSafeInteger(slot) && slot >= 0)) {
    throw new Error(`Invalid slot "${slot}" for App group "${groupName}"`);
  }
  const configured = group(config, groupName);
  const apps = Object.fromEntries(
    Object.entries(configured.apps).map(([id, app]) => {
      const port = resolveWorkgroveAppPort(app, slot, configured.slot.stride);
      if (port < MIN_WORKGROVE_PORT || port > MAX_WORKGROVE_PORT) {
        throw new Error(
          `App "${id}" in App group "${groupName}" computed invalid port ${port}`
        );
      }
      return [id, { port, url: `http://localhost:${port}` }];
    })
  );
  return { apps, name: groupName, slot };
}

export function resolveWorkgroveAppGroups(
  config: WorkgroveConfig,
  assignments: Partial<WorkgroveSlotAssignments>
): Record<string, ResolvedWorkgroveAppGroup> {
  const slots = { ...defaultWorkgroveSlots(config), ...assignments };
  return Object.fromEntries(
    Object.keys(config.appGroups).map((name) => [
      name,
      resolveWorkgroveAppGroup(
        config,
        name,
        slots[name] ?? config.appGroups[name].slot.default
      ),
    ])
  );
}

export function workgroveCommandEnvironment(
  config: WorkgroveConfig,
  assignments: Partial<WorkgroveSlotAssignments>
): Record<string, string> {
  const appGroups = resolveWorkgroveAppGroups(config, assignments);
  return Object.fromEntries(
    Object.entries(config.env ?? {}).map(([name, template]) => [
      name,
      renderWorkgroveTemplate(template, { appGroups }),
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

interface LegacyConfig {
  $schema?: string;
  apps?: Record<string, { basePort: number }>;
  env?: Record<string, string>;
  setup?: WorkgroveCommand;
  start?: WorkgroveCommand;
  stride?: number;
  version?: 1;
}

function migrateLegacyTemplate(template: string): string {
  return template
    .replaceAll("{slot}", "{appGroups.Apps.slot}")
    .replace(
      /\{apps\.([^{}]+)\.(port|url)\}/g,
      (_match, app, field) => `{appGroups.Apps.apps.${app}.${field}}`
    );
}

function normalizeConfig(raw: unknown): unknown {
  if (!(raw && typeof raw === "object" && !Array.isArray(raw))) {
    return raw;
  }
  const candidate = raw as LegacyConfig & Record<string, unknown>;
  if ((candidate as Record<string, unknown>).version === 2) {
    return raw;
  }
  const apps = candidate.apps;
  if (!(apps && typeof apps === "object")) {
    return raw;
  }
  return {
    ...(candidate.$schema ? { $schema: candidate.$schema } : {}),
    version: 2,
    setup: candidate.setup ?? defaultWorkgroveSetupCommand(),
    appGroups: {
      Apps: {
        slot: {
          default: 0,
          stride: candidate.stride ?? 10,
        },
        start: candidate.start ?? defaultWorkgroveStartCommand(),
        stop: "process",
        apps,
      },
    },
    env: {
      WORKGROVE_SLOT: "{appGroups.Apps.slot}",
      ...Object.fromEntries(
        Object.entries(candidate.env ?? {}).map(([name, template]) => [
          name,
          migrateLegacyTemplate(template),
        ])
      ),
    },
  };
}

export function loadWorkgroveConfigDocument(
  path: string
): WorkgroveConfigDocument {
  const content = readFileSync(path, "utf8");
  const result = WorkgroveConfigSchema.safeParse(
    normalizeConfig(JSON.parse(content))
  );
  if (!result.success) {
    throw new Error(
      `Invalid Workgrove config: ${z.prettifyError(result.error)}`
    );
  }
  resolveWorkgroveAppGroups(result.data, {});
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
  resolveWorkgroveAppGroups(validated, {});
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
  command: WorkgroveCommand,
  assignments: Partial<WorkgroveSlotAssignments>
): ResolvedWorkgroveCommand {
  return {
    argv: [...command.argv],
    env: workgroveCommandEnvironment(config, assignments),
  };
}

export function resolveStartCommand(
  config: WorkgroveConfig,
  groupName: string,
  assignments: Partial<WorkgroveSlotAssignments>
): ResolvedWorkgroveCommand {
  return resolveCommand(config, group(config, groupName).start, assignments);
}

export function resolveStopCommand(
  config: WorkgroveConfig,
  groupName: string,
  assignments: Partial<WorkgroveSlotAssignments>
): ResolvedWorkgroveCommand | null {
  const stop = group(config, groupName).stop;
  return stop === "process" ? null : resolveCommand(config, stop, assignments);
}

export function resolveSetupCommand(
  config: WorkgroveConfig,
  assignments: Partial<WorkgroveSlotAssignments>
): ResolvedWorkgroveCommand {
  return resolveCommand(config, config.setup, assignments);
}
