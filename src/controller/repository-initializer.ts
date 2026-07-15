import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { trustRepository } from "../config/repository-trust";
import type { WorkgroveCommand } from "../config/workgrove-command";
import {
  resolveWorkgroveAppGroup,
  type WorktreeEnvConfig,
} from "../config/workgrove-config";
import { WORKGROVE_SLOT_FILE } from "../config/workgrove-schema";

const LINE_BREAK = /\r?\n/;
const FASTAPI_DEPENDENCY = /\bfastapi\b/i;
const COMPOSE_FILES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
] as const;

export interface RepositoryInitializationPlan {
  config: WorktreeEnvConfig;
  configPath: string;
  detectedRuntime: string;
  detectedSetupCommand: string | null;
  detectedStartCommand: string | null;
  repoPath: string;
}

interface ProjectDefaults {
  label: string;
  setup?: WorkgroveCommand;
  start?: WorkgroveCommand;
}

function gitRoot(repoPath: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoPath,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "Not a Git repository").trim());
  }
  return realpathSync(result.stdout.trim());
}

function excludeLocalSlotFile(root: string, slotFile: string): void {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "Could not locate Git metadata").trim());
  }
  const rawDirectory = result.stdout.trim();
  const commonDirectory = isAbsolute(rawDirectory)
    ? rawDirectory
    : resolve(root, rawDirectory);
  const excludePath = join(commonDirectory, "info", "exclude");
  const content = existsSync(excludePath)
    ? readFileSync(excludePath, "utf8")
    : "";
  if (!content.split(LINE_BREAK).includes(slotFile)) {
    appendFileSync(
      excludePath,
      `${content.endsWith("\n") || content === "" ? "" : "\n"}${slotFile}\n`
    );
  }
}

function projectDefaults(root: string): ProjectDefaults {
  if (COMPOSE_FILES.some((file) => existsSync(join(root, file)))) {
    return {
      label: "Docker Compose",
      start: {
        argv: ["docker", "compose", "up"],
      },
    };
  }
  if (existsSync(join(root, "package.json"))) {
    return {
      label: "Node.js · bun",
      setup: { argv: ["bun", "install"] },
      start: { argv: ["bun", "dev"] },
    };
  }
  if (existsSync(join(root, "manage.py"))) {
    return { label: "Python · Django" };
  }
  if (existsSync(join(root, "pyproject.toml"))) {
    const content = readFileSync(join(root, "pyproject.toml"), "utf8");
    if (FASTAPI_DEPENDENCY.test(content)) {
      const usesUv = existsSync(join(root, "uv.lock"));
      return {
        label: "Python · FastAPI",
        ...(usesUv ? { setup: { argv: ["uv", "sync"] } } : {}),
      };
    }
    return { label: "Python" };
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    return {
      label: "Rust · Cargo",
      setup: { argv: ["cargo", "fetch"] },
      start: { argv: ["cargo", "run"] },
    };
  }
  if (existsSync(join(root, "go.mod"))) {
    return {
      label: "Go",
      start: { argv: ["go", "run", "."] },
    };
  }
  return { label: "Unknown" };
}

function stableBasePort(path: string): number {
  let bucket = 0;
  for (const character of path) {
    bucket = (bucket * 31 + character.charCodeAt(0)) % 250;
  }
  return 10_000 + bucket * 200;
}

export function planRepositoryInitialization(
  repoPath: string
): RepositoryInitializationPlan {
  const root = gitRoot(repoPath);
  const configPath = join(root, ".workgrove.json");
  if (existsSync(configPath)) {
    throw new Error(
      `Worktree environment config already exists: ${configPath}`
    );
  }
  const defaults = projectDefaults(root);
  const config: WorktreeEnvConfig = {
    $schema:
      "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json",
    version: 1,
    ...(defaults.setup ? { setup: defaults.setup } : {}),
    ...(defaults.start ? { start: defaults.start } : {}),
    apps: {
      app: {
        basePort: stableBasePort(root),
      },
    },
  };
  resolveWorkgroveAppGroup(config, {});
  return {
    config,
    configPath,
    detectedRuntime: defaults.label,
    detectedSetupCommand: defaults.setup?.argv.join(" ") ?? null,
    detectedStartCommand: defaults.start?.argv.join(" ") ?? null,
    repoPath: root,
  };
}

export function initializeRepository(
  repoPath: string
): RepositoryInitializationPlan {
  const plan = planRepositoryInitialization(repoPath);
  writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`, {
    flag: "wx",
  });
  excludeLocalSlotFile(plan.repoPath, WORKGROVE_SLOT_FILE);
  trustRepository(plan.repoPath, plan.config);
  return plan;
}
