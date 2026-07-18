import type { ZodType } from "zod";
import {
  CommandReceiptSchema,
  PickRepositoryResultSchema,
  RepositoryInitializationPlanSchema,
} from "../controller/command-contract";
import type {
  CommandReceipt,
  WorkspaceSnapshot,
} from "../controller/workspace-snapshot";
import {
  LogsResponseSchema,
  SessionResponseSchema,
  WorkspaceSnapshotSchema,
} from "../server/schemas";

let sessionToken: Promise<string> | null = null;

export class WorkgroveApiError extends Error {
  readonly code: string | null;
  readonly configPath: string | null;

  constructor(message: string, code: string | null, configPath: string | null) {
    super(message);
    this.code = code;
    this.configPath = configPath;
    this.name = "WorkgroveApiError";
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const value =
      body && typeof body === "object"
        ? (body as {
            code?: unknown;
            configPath?: unknown;
            error?: unknown;
          })
        : {};
    throw new WorkgroveApiError(
      typeof value.error === "string"
        ? value.error
        : `Request failed (${response.status})`,
      typeof value.code === "string" ? value.code : null,
      typeof value.configPath === "string" ? value.configPath : null
    );
  }
  return body;
}

function token(): Promise<string> {
  sessionToken ??= fetch("/api/session")
    .then(responseJson)
    .then((body) => SessionResponseSchema.parse(body).token);
  return sessionToken;
}

export async function fetchWorkspace(
  repoPath: string
): Promise<WorkspaceSnapshot> {
  const query = new URLSearchParams({ repoPath });
  return WorkspaceSnapshotSchema.parse(
    await responseJson(await fetch(`/api/workspace?${query}`))
  ) as WorkspaceSnapshot;
}

export async function fetchLogs(
  repoPath: string,
  worktreeId: string,
  appGroupName: string
): Promise<string[]> {
  const query = new URLSearchParams({ appGroupName, repoPath, worktreeId });
  const body = LogsResponseSchema.parse(
    await responseJson(await fetch(`/api/logs?${query}`))
  );
  return body.lines;
}

export function runCommand(
  command: string,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  return postCommand(
    command,
    input,
    CommandReceiptSchema
  ) as Promise<CommandReceipt>;
}

async function postCommand<T>(
  command: string,
  input: Record<string, unknown>,
  schema: ZodType<T>
): Promise<T> {
  async function request(): Promise<Response> {
    return fetch(`/api/commands/${command}`, {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-workgrove-token": await token(),
      },
      method: "POST",
    });
  }
  let response = await request();
  if (response.status === 403) {
    sessionToken = null;
    response = await request();
  }
  return schema.parse(await responseJson(response));
}

export function pickRepository(): Promise<string | null> {
  return postCommand("pick-repository", {}, PickRepositoryResultSchema).then(
    (result) => result.path
  );
}

export function previewRepositoryConfig(repoPath: string) {
  return postCommand(
    "preview-repository-config",
    { repoPath },
    RepositoryInitializationPlanSchema
  );
}

export function initializeRepository(repoPath: string) {
  return postCommand(
    "initialize-repository",
    { repoPath },
    RepositoryInitializationPlanSchema
  );
}
