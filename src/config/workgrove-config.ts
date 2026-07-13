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
import type {
  RepositoryCommandProfile,
  WorkgroveCommand,
} from "./workgrove-command";
import {
  canonicalizeWorkgroveConfig,
  MAX_WORKGROVE_PORT,
  MIN_WORKGROVE_PORT,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "./workgrove-schema";

// biome-ignore lint/performance/noBarrelFile: preserve the existing internal config-module type exports during the browser-safe schema split.
export {
  type WorkgroveApp,
  WorkgroveAppIdSchema,
  WorkgroveAppSchema,
  type WorkgroveConfig,
  WorkgroveConfigSchema,
  type WorktreeEnvConfig,
} from "./workgrove-schema";

const SLOT_PATTERN = /^\d+$/;
const TEMPLATE_PATTERN = /\{([^}]+)\}/g;
const APP_TEMPLATE_PATTERN = /^apps\.([a-zA-Z0-9_-]+)\.(port|url)$/;
export interface ResolvedWorkgroveApp {
  env: Record<string, string>;
  port: number;
  url: string;
}

export interface ResolvedWorkgroveRuntime {
  apps: Record<string, ResolvedWorkgroveApp>;
  slot: number;
}

export interface ResolvedWorkgroveCommand {
  appId: string | null;
  argv: string[];
  cwd: string | null;
  env: Record<string, string>;
}

export interface WorkgroveConfigDocument {
  config: WorkgroveConfig;
  revision: string;
}

interface TemplateContext {
  apps: Record<string, { port: number; url: string }>;
  port: number;
  slot: number;
  url?: string;
}

function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(TEMPLATE_PATTERN, (_, token: string) => {
    if (token === "slot") {
      return String(context.slot);
    }
    if (token === "port") {
      return String(context.port);
    }
    if (token === "url" && context.url) {
      return context.url;
    }
    const match = APP_TEMPLATE_PATTERN.exec(token);
    const app = match ? context.apps[match[1]] : null;
    if (match && app) {
      return String(app[match[2] as "port" | "url"]);
    }
    throw new Error(`Unknown Workgrove template variable "${token}"`);
  });
}

export function renderCommandEnvironment(
  values: Record<string, string> | undefined,
  context: TemplateContext
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([name, value]) => [
      name,
      renderTemplate(value, context),
    ])
  );
}

export function resolveWorkgroveRuntime(
  config: WorkgroveConfig,
  environment: Record<string, string | undefined>
): ResolvedWorkgroveRuntime {
  WorkgroveConfigSchema.parse(config);
  const rawSlot = environment[config.slot.env] ?? String(config.slot.default);
  if (!SLOT_PATTERN.test(rawSlot)) {
    throw new Error(`Invalid ${config.slot.env} "${rawSlot}"`);
  }
  const slot = Number(rawSlot);
  const entries = Object.entries(config.apps);
  const endpoints: Record<string, { port: number; url: string }> = {};
  for (const [id, app] of entries) {
    const port = config.range.base + slot * config.range.stride + app.offset;
    if (port < MIN_WORKGROVE_PORT || port > MAX_WORKGROVE_PORT) {
      throw new Error(`App "${id}" computed invalid port ${port}`);
    }
    endpoints[id] = {
      port,
      url: renderTemplate(config.url, { apps: endpoints, port, slot }),
    };
  }
  const apps = Object.fromEntries(
    entries.map(([id, app]) => {
      const endpoint = endpoints[id];
      return [
        id,
        {
          ...endpoint,
          env: renderCommandEnvironment(app.exports, {
            apps: endpoints,
            port: endpoint.port,
            slot,
            url: endpoint.url,
          }),
        },
      ];
    })
  );
  return { apps, slot };
}

export function findWorkgroveConfig(root: string): string | null {
  for (const name of [".workgrove.json", ".worktree-env.json"]) {
    const path = join(root, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
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
  return config.control?.setup ?? config.control?.postCreate ?? null;
}

export function repositoryCommandProfile(
  config: WorkgroveConfig
): RepositoryCommandProfile {
  const hasPerAppStart = Object.values(config.apps).some(
    (app) => app.start !== undefined
  );
  let startMode: RepositoryCommandProfile["startMode"] = "none";
  if (hasPerAppStart) {
    startMode = "per-app";
  } else if (config.control?.start) {
    startMode = "aggregate";
  }
  return {
    setup: configuredSetupCommand(config),
    start: hasPerAppStart ? null : (config.control?.start ?? null),
    startMode,
  };
}

export function updateRepositoryCommandProfile(
  configPath: string,
  update: {
    setup: WorkgroveCommand | null;
    start?: WorkgroveCommand | null;
  }
): WorkgroveConfig {
  const current = loadWorkgroveConfigDocument(configPath);
  const next = structuredClone(current.config);
  next.control ??= {};
  next.control.postCreate = undefined;
  if (update.setup) {
    next.control.setup = update.setup;
  } else {
    next.control.setup = undefined;
  }
  if (update.start !== undefined) {
    if (Object.values(next.apps).some((app) => app.start !== undefined)) {
      throw new Error(
        "Start is configured per app; edit the app start commands in .workgrove.json"
      );
    }
    if (update.start) {
      next.control.start = update.start;
    } else {
      next.control.start = undefined;
    }
  }
  return updateWorkgroveConfig(configPath, next, current.revision).config;
}

export function resolveStartCommands(
  config: WorkgroveConfig,
  slot: number
): ResolvedWorkgroveCommand[] {
  const slotEnvironment = { [config.slot.env]: String(slot) };
  const runtime = resolveWorkgroveRuntime(config, slotEnvironment);
  const endpoints = Object.fromEntries(
    Object.entries(runtime.apps).map(([id, app]) => [
      id,
      { port: app.port, url: app.url },
    ])
  );
  const perApp = Object.entries(config.apps).flatMap(([appId, app]) => {
    if (!app.start) {
      return [];
    }
    const resolved = runtime.apps[appId];
    return [
      {
        appId,
        argv: app.start.argv.map((value) =>
          renderTemplate(value, {
            apps: endpoints,
            port: resolved.port,
            slot,
            url: resolved.url,
          })
        ),
        cwd: app.start.cwd
          ? renderTemplate(app.start.cwd, {
              apps: endpoints,
              port: resolved.port,
              slot,
              url: resolved.url,
            })
          : null,
        env: {
          ...slotEnvironment,
          ...resolved.env,
          ...renderCommandEnvironment(app.start.env, {
            apps: endpoints,
            port: resolved.port,
            slot,
            url: resolved.url,
          }),
        },
      },
    ];
  });
  if (perApp.length > 0) {
    return perApp;
  }
  const aggregate = config.control?.start;
  if (!aggregate) {
    return [];
  }
  const first = Object.values(runtime.apps)[0];
  return [
    {
      appId: null,
      argv: aggregate.argv.map((value) =>
        renderTemplate(value, {
          apps: endpoints,
          port: first.port,
          slot,
          url: first.url,
        })
      ),
      cwd: aggregate.cwd
        ? renderTemplate(aggregate.cwd, {
            apps: endpoints,
            port: first.port,
            slot,
            url: first.url,
          })
        : null,
      env: {
        ...slotEnvironment,
        ...renderCommandEnvironment(aggregate.env, {
          apps: endpoints,
          port: first.port,
          slot,
          url: first.url,
        }),
      },
    },
  ];
}

export function resolveSetupCommand(
  config: WorkgroveConfig,
  slot: number
): ResolvedWorkgroveCommand | null {
  const command = configuredSetupCommand(config);
  if (!command) {
    return null;
  }
  const slotEnvironment = { [config.slot.env]: String(slot) };
  const runtime = resolveWorkgroveRuntime(config, slotEnvironment);
  const endpoints = Object.fromEntries(
    Object.entries(runtime.apps).map(([id, app]) => [
      id,
      { port: app.port, url: app.url },
    ])
  );
  const first = Object.values(runtime.apps)[0];
  return {
    appId: null,
    argv: command.argv.map((value) =>
      renderTemplate(value, {
        apps: endpoints,
        port: first.port,
        slot,
        url: first.url,
      })
    ),
    cwd: command.cwd
      ? renderTemplate(command.cwd, {
          apps: endpoints,
          port: first.port,
          slot,
          url: first.url,
        })
      : null,
    env: {
      ...slotEnvironment,
      ...renderCommandEnvironment(command.env, {
        apps: endpoints,
        port: first.port,
        slot,
        url: first.url,
      }),
    },
  };
}

export const resolvePostCreateCommand = resolveSetupCommand;
