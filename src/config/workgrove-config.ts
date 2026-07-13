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
  type RepositoryCommandProfile,
  type WorkgroveCommand,
  WorkgroveCommandSchema,
} from "./workgrove-command";

const SLOT_PATTERN = /^\d+$/;
const TEMPLATE_PATTERN = /\{([^}]+)\}/g;
const APP_TEMPLATE_PATTERN = /^apps\.([a-zA-Z0-9_-]+)\.(port|url)$/;
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

const WorkgroveAppSchema = z.object({
  control: z
    .object({
      label: z.string().min(1).optional(),
      open: z.boolean().optional(),
      probe: z.enum(["none", "tcp"]).optional(),
      required: z.boolean().optional(),
    })
    .optional(),
  exports: z.record(z.string(), z.string()).optional(),
  offset: z.number().int().nonnegative(),
  start: WorkgroveCommandSchema.optional(),
});

const WorkgroveControlSchema = z
  .object({
    postCreate: WorkgroveCommandSchema.optional(),
    setup: WorkgroveCommandSchema.optional(),
    start: WorkgroveCommandSchema.optional(),
  })
  .refine((control) => !(control.setup && control.postCreate), {
    message: "Configure control.setup or legacy control.postCreate, not both",
  });

export const WorkgroveConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  apps: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), WorkgroveAppSchema),
  control: WorkgroveControlSchema.optional(),
  range: z.object({
    base: z.number().int().min(MIN_PORT).max(MAX_PORT),
    stride: z.number().int().positive().max(MAX_PORT),
  }),
  slot: z.object({
    default: z.number().int().nonnegative(),
    env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    file: z.string().min(1).optional(),
  }),
  url: z.string().min(1),
});

export type WorkgroveConfig = z.infer<typeof WorkgroveConfigSchema>;
export type WorktreeEnvConfig = WorkgroveConfig;

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

interface TemplateContext {
  apps: Record<string, { port: number; url: string }>;
  port: number;
  slot: number;
  url?: string;
}

function validateStartMode(config: WorkgroveConfig): void {
  const perAppEntries = Object.entries(config.apps).filter(
    ([, app]) => app.start !== undefined
  );
  if (perAppEntries.length === 0) {
    return;
  }
  if (config.control?.start) {
    throw new Error(
      "Configure either per-app start commands or control.start, not both"
    );
  }
  const missing = Object.entries(config.apps)
    .filter(([, app]) => {
      const probe = app.control?.probe ?? "tcp";
      const required = app.control?.required ?? probe === "tcp";
      return probe === "tcp" && required && !app.start;
    })
    .map(([id]) => id);
  if (missing.length > 0) {
    throw new Error(
      `Required apps need start commands in per-app mode: ${missing.join(", ")}`
    );
  }
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
  validateStartMode(config);
  const rawSlot = environment[config.slot.env] ?? String(config.slot.default);
  if (!SLOT_PATTERN.test(rawSlot)) {
    throw new Error(`Invalid ${config.slot.env} "${rawSlot}"`);
  }
  const slot = Number(rawSlot);
  const entries = Object.entries(config.apps);
  if (entries.length === 0) {
    throw new Error("Workgrove config requires at least one app");
  }
  const seenOffsets = new Set<number>();
  for (const [id, app] of entries) {
    if (app.offset >= config.range.stride) {
      throw new Error(`App "${id}" offset must be below range.stride`);
    }
    if (seenOffsets.has(app.offset)) {
      throw new Error(`App offset ${app.offset} is assigned more than once`);
    }
    seenOffsets.add(app.offset);
  }
  const endpoints: Record<string, { port: number; url: string }> = {};
  for (const [id, app] of entries) {
    const port = config.range.base + slot * config.range.stride + app.offset;
    if (port < MIN_PORT || port > MAX_PORT) {
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

export function loadWorkgroveConfig(path: string): WorkgroveConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const candidate = raw.version === undefined ? { ...raw, version: 1 } : raw;
  const result = WorkgroveConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `Invalid Workgrove config: ${z.prettifyError(result.error)}`
    );
  }
  resolveWorkgroveRuntime(result.data, {});
  return result.data;
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
  const current = loadWorkgroveConfig(configPath);
  const next = structuredClone(current);
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
  const validated = WorkgroveConfigSchema.parse(next);
  resolveWorkgroveRuntime(validated, {});
  const temporaryPath = `${configPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return validated;
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
