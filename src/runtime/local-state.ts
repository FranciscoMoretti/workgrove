import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface EndpointAssignment {
  appId: string;
  groupId: string;
  hostname: string;
  id: string;
  routeLabel: string;
}

export interface RunEndpoint {
  appId: string;
  directUrl?: string;
  host: string;
  hostname?: string;
  port: number;
  protocol: "http" | "tcp";
  url?: string;
}

export interface AppGroupRun {
  apps: Record<string, RunEndpoint>;
  createdAt: string;
  groupId: string;
}

interface WorktreeRecord {
  endpoints: Record<string, EndpointAssignment>;
  id: string;
  path: string;
  routeLabel: string;
  runs: Record<string, AppGroupRun>;
}

interface RepositoryRecord {
  id: string;
  path: string;
  routeLabel: string;
  worktrees: Record<string, WorktreeRecord>;
}

interface WorkgroveLocalState {
  repositories: Record<string, RepositoryRecord>;
  version: 1;
}

export interface EndpointRequest {
  appId: string;
  appLabel: string;
  groupId: string;
  repoLabel: string;
  repoPath: string;
  worktreeLabel: string;
  worktreePath: string;
}

export interface RunKey {
  groupId: string;
  repoPath: string;
  worktreePath: string;
}

function emptyState(): WorkgroveLocalState {
  return { repositories: {}, version: 1 };
}

function routeLabel(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized || "app";
}

function uniqueLabel(base: string, used: Set<string>, id: string): string {
  const candidate = routeLabel(base);
  if (!used.has(candidate)) {
    return candidate;
  }
  return `${candidate}-${id.replaceAll("-", "").slice(0, 6)}`;
}

function endpointKey(groupId: string, appId: string): string {
  return `${groupId}\0${appId}`;
}

export class FileWorkgroveStateStore {
  readonly path: string;

  constructor(path = join(homedir(), ".workgrove", "state.json")) {
    this.path = path;
  }

  endpoint(request: EndpointRequest): EndpointAssignment {
    const state = this.read();
    const repository = this.repository(state, request);
    const worktree = this.worktree(repository, request);
    const key = endpointKey(request.groupId, request.appId);
    const existing = worktree.endpoints[key];
    if (existing) {
      return structuredClone(existing);
    }
    const id = randomUUID();
    const label = uniqueLabel(
      request.appLabel,
      new Set(Object.values(worktree.endpoints).map((item) => item.routeLabel)),
      id
    );
    const assignment: EndpointAssignment = {
      appId: request.appId,
      groupId: request.groupId,
      hostname: `${label}.${worktree.routeLabel}.${repository.routeLabel}.localhost`,
      id,
      routeLabel: label,
    };
    worktree.endpoints[key] = assignment;
    this.write(state);
    return structuredClone(assignment);
  }

  run(key: RunKey): AppGroupRun | null {
    const state = this.read();
    return structuredClone(
      state.repositories[key.repoPath]?.worktrees[key.worktreePath]?.runs[
        key.groupId
      ] ?? null
    );
  }

  saveRun(key: RunKey, run: AppGroupRun): void {
    const state = this.read();
    const repository = state.repositories[key.repoPath];
    const worktree = repository?.worktrees[key.worktreePath];
    if (!worktree) {
      throw new Error(
        "Endpoint identity must be assigned before a run is saved"
      );
    }
    worktree.runs[key.groupId] = structuredClone(run);
    this.write(state);
  }

  removeRun(key: RunKey): void {
    const state = this.read();
    const runs =
      state.repositories[key.repoPath]?.worktrees[key.worktreePath]?.runs;
    if (!(runs && Object.hasOwn(runs, key.groupId))) {
      return;
    }
    delete runs[key.groupId];
    this.write(state);
  }

  leasedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const repository of Object.values(this.read().repositories)) {
      for (const worktree of Object.values(repository.worktrees)) {
        for (const run of Object.values(worktree.runs)) {
          for (const app of Object.values(run.apps)) {
            ports.add(app.port);
          }
        }
      }
    }
    return ports;
  }

  private read(): WorkgroveLocalState {
    if (!existsSync(this.path)) {
      return emptyState();
    }
    try {
      const value = JSON.parse(
        readFileSync(this.path, "utf8")
      ) as Partial<WorkgroveLocalState>;
      if (
        value.version !== 1 ||
        !value.repositories ||
        typeof value.repositories !== "object"
      ) {
        throw new Error("Unsupported Workgrove local state");
      }
      return value as WorkgroveLocalState;
    } catch (error) {
      throw new Error(
        `Invalid Workgrove local state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private repository(
    state: WorkgroveLocalState,
    request: EndpointRequest
  ): RepositoryRecord {
    const existing = state.repositories[request.repoPath];
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    const record: RepositoryRecord = {
      id,
      path: request.repoPath,
      routeLabel: uniqueLabel(
        request.repoLabel,
        new Set(
          Object.values(state.repositories).map((item) => item.routeLabel)
        ),
        id
      ),
      worktrees: {},
    };
    state.repositories[request.repoPath] = record;
    return record;
  }

  private worktree(
    repository: RepositoryRecord,
    request: EndpointRequest
  ): WorktreeRecord {
    const existing = repository.worktrees[request.worktreePath];
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    const record: WorktreeRecord = {
      endpoints: {},
      id,
      path: request.worktreePath,
      routeLabel: uniqueLabel(
        request.worktreeLabel,
        new Set(
          Object.values(repository.worktrees).map((item) => item.routeLabel)
        ),
        id
      ),
      runs: {},
    };
    repository.worktrees[request.worktreePath] = record;
    return record;
  }

  private write(state: WorkgroveLocalState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      renameSync(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
