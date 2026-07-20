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

export type AppGroupInstanceMode = "per-worktree" | "selectable";

export interface EndpointAssignment {
  appId: string;
  groupId: string;
  hostname: string;
  id: string;
  port: number | null;
  routeLabel: string;
}

export interface RunEndpoint {
  appId: string;
  directUrl?: string;
  host: string;
  hostname?: string;
  listenerClaimed?: boolean;
  port: number;
  protocol: "http" | "tcp";
  url?: string;
}

export interface AppGroupRun {
  apps: Record<string, RunEndpoint>;
  createdAt: string;
  groupId: string;
  instanceId: string;
  instanceIdsByGroup: Record<string, string>;
  worktreePath: string;
}

export interface AppGroupInstance {
  endpoints: Record<string, EndpointAssignment>;
  groupId: string;
  id: string;
  isDefault: boolean;
  mode: AppGroupInstanceMode;
  name: string;
  routeLabel: string;
  run: AppGroupRun | null;
  worktreePath: string | null;
}

interface WorktreeRecord {
  id: string;
  instanceSelections: Record<string, string>;
  path: string;
  routeLabel: string;
}

interface RepositoryRecord {
  id: string;
  instances: Record<string, AppGroupInstance>;
  path: string;
  routeLabel: string;
  worktrees: Record<string, WorktreeRecord>;
}

interface WorkgroveLocalState {
  repositories: Record<string, RepositoryRecord>;
  version: 2;
}

export interface InstanceRequest {
  groupId: string;
  mode: AppGroupInstanceMode;
  repoLabel: string;
  repoPath: string;
  worktreeLabel: string;
  worktreePath: string;
}

export interface EndpointRequest {
  appId: string;
  appLabel: string;
  groupId: string;
  instanceId: string;
  repoPath: string;
}

export interface RunKey {
  instanceId: string;
  repoPath: string;
}

interface LegacyEndpointAssignment {
  appId: string;
  groupId: string;
  hostname: string;
  id: string;
  routeLabel: string;
}

interface LegacyWorktreeRecord {
  endpoints: Record<string, LegacyEndpointAssignment>;
  id: string;
  path: string;
  routeLabel: string;
  runs: Record<
    string,
    Omit<AppGroupRun, "instanceId" | "instanceIdsByGroup" | "worktreePath">
  >;
}

interface LegacyRepositoryRecord {
  id: string;
  path: string;
  routeLabel: string;
  worktrees: Record<string, LegacyWorktreeRecord>;
}

interface LegacyWorkgroveLocalState {
  repositories: Record<string, LegacyRepositoryRecord>;
  version: 1;
}

const DEFAULT_INSTANCE_NAME = "Default";

function emptyState(): WorkgroveLocalState {
  return { repositories: {}, version: 2 };
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

function namesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;
}

function cloneInstance(instance: AppGroupInstance): AppGroupInstance {
  return structuredClone(instance);
}

function migrateLegacyState(
  legacy: LegacyWorkgroveLocalState
): WorkgroveLocalState {
  const repositories: Record<string, RepositoryRecord> = {};
  for (const [repoPath, repository] of Object.entries(legacy.repositories)) {
    const migrated: RepositoryRecord = {
      id: repository.id,
      instances: {},
      path: repository.path,
      routeLabel: repository.routeLabel,
      worktrees: {},
    };
    for (const [worktreePath, worktree] of Object.entries(
      repository.worktrees
    )) {
      migrated.worktrees[worktreePath] = {
        id: worktree.id,
        instanceSelections: {},
        path: worktree.path,
        routeLabel: worktree.routeLabel,
      };
      const groupIds = new Set([
        ...Object.values(worktree.endpoints).map((item) => item.groupId),
        ...Object.keys(worktree.runs),
      ]);
      for (const groupId of groupIds) {
        const id = randomUUID();
        const legacyRun = worktree.runs[groupId];
        const endpoints = Object.fromEntries(
          Object.values(worktree.endpoints)
            .filter((endpoint) => endpoint.groupId === groupId)
            .map((endpoint) => [
              endpointKey(groupId, endpoint.appId),
              {
                ...endpoint,
                port: legacyRun?.apps[endpoint.appId]?.port ?? null,
              } satisfies EndpointAssignment,
            ])
        );
        migrated.instances[id] = {
          endpoints,
          groupId,
          id,
          isDefault: false,
          mode: "per-worktree",
          name: worktree.routeLabel,
          routeLabel: worktree.routeLabel,
          run: legacyRun
            ? {
                ...legacyRun,
                instanceId: id,
                instanceIdsByGroup: { [groupId]: id },
                worktreePath,
              }
            : null,
          worktreePath,
        };
      }
    }
    repositories[repoPath] = migrated;
  }
  return { repositories, version: 2 };
}

export class FileWorkgroveStateStore {
  readonly path: string;

  constructor(path = join(homedir(), ".workgrove", "state.json")) {
    this.path = path;
  }

  instance(request: InstanceRequest): AppGroupInstance {
    const state = this.read();
    const repository = this.repository(state, request);
    const worktree = this.worktree(repository, request);
    const existing = this.selectedInstance(repository, worktree, request);
    if (existing) {
      return cloneInstance(existing);
    }
    const instance = this.createInstanceRecord(repository, worktree, request, {
      isDefault: request.mode === "selectable",
      name:
        request.mode === "per-worktree"
          ? request.worktreeLabel
          : DEFAULT_INSTANCE_NAME,
      worktreePath:
        request.mode === "per-worktree" ? request.worktreePath : null,
    });
    if (request.mode === "selectable") {
      worktree.instanceSelections[request.groupId] = instance.id;
    }
    this.write(state);
    return cloneInstance(instance);
  }

  instances(repoPath: string, groupId: string): AppGroupInstance[] {
    const repository = this.read().repositories[repoPath];
    if (!repository) {
      return [];
    }
    return Object.values(repository.instances)
      .filter(
        (instance) =>
          instance.groupId === groupId && instance.mode === "selectable"
      )
      .toSorted((left, right) => {
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map(cloneInstance);
  }

  instanceById(repoPath: string, instanceId: string): AppGroupInstance | null {
    const instance = this.read().repositories[repoPath]?.instances[instanceId];
    return instance ? cloneInstance(instance) : null;
  }

  createSelectableInstance(
    request: InstanceRequest,
    name: string
  ): AppGroupInstance {
    if (request.mode !== "selectable") {
      throw new Error("Only selectable App groups can create named instances");
    }
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Instance name is required");
    }
    if (namesEqual(normalizedName, DEFAULT_INSTANCE_NAME)) {
      throw new Error(`Instance name "${DEFAULT_INSTANCE_NAME}" is reserved`);
    }
    const state = this.read();
    const repository = this.repository(state, request);
    const worktree = this.worktree(repository, request);
    const duplicate = Object.values(repository.instances).some(
      (instance) =>
        instance.groupId === request.groupId &&
        instance.mode === "selectable" &&
        namesEqual(instance.name, normalizedName)
    );
    if (duplicate) {
      throw new Error(`An instance named "${normalizedName}" already exists`);
    }
    const instance = this.createInstanceRecord(repository, worktree, request, {
      isDefault: false,
      name: normalizedName,
      worktreePath: null,
    });
    worktree.instanceSelections[request.groupId] = instance.id;
    this.write(state);
    return cloneInstance(instance);
  }

  selectInstance(
    request: InstanceRequest,
    instanceId: string
  ): AppGroupInstance {
    if (request.mode !== "selectable") {
      throw new Error(
        "Per-worktree App groups select their instance automatically"
      );
    }
    const state = this.read();
    const repository = this.repository(state, request);
    const worktree = this.worktree(repository, request);
    const instance = repository.instances[instanceId];
    if (
      !instance ||
      instance.groupId !== request.groupId ||
      instance.mode !== "selectable"
    ) {
      throw new Error("Unknown App-group instance");
    }
    worktree.instanceSelections[request.groupId] = instance.id;
    this.write(state);
    return cloneInstance(instance);
  }

  endpoint(request: EndpointRequest): EndpointAssignment {
    const state = this.read();
    const repository = state.repositories[request.repoPath];
    const instance = repository?.instances[request.instanceId];
    if (!(repository && instance && instance.groupId === request.groupId)) {
      throw new Error(
        "App-group instance must be assigned before its endpoints"
      );
    }
    const key = endpointKey(request.groupId, request.appId);
    const existing =
      instance.endpoints[key] ?? instance.endpoints[request.appId];
    if (existing) {
      return structuredClone(existing);
    }
    const id = randomUUID();
    const label = uniqueLabel(
      request.appLabel,
      new Set(
        Object.values(repository.instances)
          .filter((candidate) => candidate.routeLabel === instance.routeLabel)
          .flatMap((candidate) =>
            Object.values(candidate.endpoints).map((item) => item.routeLabel)
          )
      ),
      id
    );
    const assignment: EndpointAssignment = {
      appId: request.appId,
      groupId: request.groupId,
      hostname: `${label}.${instance.routeLabel}.${repository.routeLabel}.localhost`,
      id,
      port: null,
      routeLabel: label,
    };
    instance.endpoints[key] = assignment;
    this.write(state);
    return structuredClone(assignment);
  }

  assignEndpointPort(
    key: RunKey,
    appId: string,
    port: number
  ): EndpointAssignment {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    const endpoint = instance?.endpoints[endpointKey(instance.groupId, appId)];
    if (!(instance && endpoint)) {
      throw new Error("Endpoint identity must be assigned before its port");
    }
    if (endpoint.port !== null && endpoint.port !== port) {
      throw new Error(`${appId} already has a stable backing port`);
    }
    endpoint.port = port;
    this.write(state);
    return structuredClone(endpoint);
  }

  run(key: RunKey): AppGroupRun | null {
    return structuredClone(
      this.read().repositories[key.repoPath]?.instances[key.instanceId]?.run ??
        null
    );
  }

  saveRun(key: RunKey, run: AppGroupRun): void {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    if (!instance) {
      throw new Error("App-group instance must exist before a run is saved");
    }
    instance.run = structuredClone(run);
    this.write(state);
  }

  removeRun(key: RunKey): void {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    if (!instance?.run) {
      return;
    }
    instance.run = null;
    this.write(state);
  }

  leasedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const repository of Object.values(this.read().repositories)) {
      for (const instance of Object.values(repository.instances)) {
        for (const endpoint of Object.values(instance.endpoints)) {
          if (endpoint.port !== null) {
            ports.add(endpoint.port);
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
      const value = JSON.parse(readFileSync(this.path, "utf8")) as
        | Partial<WorkgroveLocalState>
        | LegacyWorkgroveLocalState;
      if (value.version === 1 && value.repositories) {
        const migrated = migrateLegacyState(value as LegacyWorkgroveLocalState);
        this.write(migrated);
        return migrated;
      }
      if (
        value.version !== 2 ||
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
    request: Pick<InstanceRequest, "repoLabel" | "repoPath">
  ): RepositoryRecord {
    const existing = state.repositories[request.repoPath];
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    const record: RepositoryRecord = {
      id,
      instances: {},
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
    request: Pick<InstanceRequest, "worktreeLabel" | "worktreePath">
  ): WorktreeRecord {
    const existing = repository.worktrees[request.worktreePath];
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    const record: WorktreeRecord = {
      id,
      instanceSelections: {},
      path: request.worktreePath,
      routeLabel: uniqueLabel(
        request.worktreeLabel,
        new Set([
          ...Object.values(repository.worktrees).map((item) => item.routeLabel),
          ...Object.values(repository.instances).map((item) => item.routeLabel),
        ]),
        id
      ),
    };
    repository.worktrees[request.worktreePath] = record;
    return record;
  }

  private selectedInstance(
    repository: RepositoryRecord,
    worktree: WorktreeRecord,
    request: InstanceRequest
  ): AppGroupInstance | null {
    if (request.mode === "per-worktree") {
      return (
        Object.values(repository.instances).find(
          (instance) =>
            instance.groupId === request.groupId &&
            instance.mode === "per-worktree" &&
            instance.worktreePath === request.worktreePath
        ) ?? null
      );
    }
    const selected =
      repository.instances[worktree.instanceSelections[request.groupId] ?? ""];
    if (
      selected?.groupId === request.groupId &&
      selected.mode === "selectable"
    ) {
      return selected;
    }
    return (
      Object.values(repository.instances).find(
        (instance) =>
          instance.groupId === request.groupId &&
          instance.mode === "selectable" &&
          instance.isDefault
      ) ?? null
    );
  }

  private createInstanceRecord(
    repository: RepositoryRecord,
    worktree: WorktreeRecord,
    request: InstanceRequest,
    input: {
      isDefault: boolean;
      name: string;
      worktreePath: string | null;
    }
  ): AppGroupInstance {
    const id = randomUUID();
    const record: AppGroupInstance = {
      endpoints: {},
      groupId: request.groupId,
      id,
      isDefault: input.isDefault,
      mode: request.mode,
      name: input.name,
      routeLabel:
        request.mode === "per-worktree"
          ? worktree.routeLabel
          : uniqueLabel(
              input.name,
              new Set([
                ...Object.values(repository.instances).map(
                  (item) => item.routeLabel
                ),
                ...Object.values(repository.worktrees).map(
                  (item) => item.routeLabel
                ),
              ]),
              id
            ),
      run: null,
      worktreePath: input.worktreePath,
    };
    repository.instances[id] = record;
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
