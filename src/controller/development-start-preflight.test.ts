import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../runtime/local-routing";
import { FileWorkgroveStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { WorkspaceController } from "./workspace-controller";

class InMemoryRoutingEngine implements LocalRoutingEngine {
  activate(_route: LocalRoute): Promise<void> {
    return Promise.resolve();
  }

  deactivate(_route: LocalRoute): Promise<void> {
    return Promise.resolve();
  }

  observe(_route: LocalRoute): LocalRouteState {
    return "inactive";
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  url(hostname: string): string {
    return `http://${hostname}:1355`;
  }
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

it("runs the development Start preflight before local state or repository code", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-start-preflight-"));
  const repository = join(temporary, "project");
  const marker = join(temporary, "repository-command-ran");
  mkdirSync(repository);
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "workgrove@example.test");
  git(repository, "config", "user.name", "Workgrove Test");
  writeFileSync(
    join(repository, ".workgrove.json"),
    JSON.stringify({
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        Chat: {
          apps: { chat: { protocol: "http", readiness: "tcp" } },
          env: { PORT: "{apps.chat.port}" },
          start: {
            argv: [
              process.execPath,
              "-e",
              `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`,
            ],
          },
          stop: "process",
        },
      },
    })
  );
  git(repository, "add", ".workgrove.json");
  git(repository, "commit", "-qm", "test config");

  const statePath = join(temporary, "state.json");
  const controller = new WorkspaceController(undefined, {
    processes: new ProcessSupervisor(join(temporary, "processes")),
    routing: new InMemoryRoutingEngine(),
    developmentStartPreflight: () => {
      throw new Error("Production Workgrove is already using this worktree");
    },
    state: new FileWorkgroveStateStore(statePath),
  });
  const worktreeId = Buffer.from(realpathSync(repository)).toString(
    "base64url"
  );

  try {
    await expect(
      controller.startAppGroup(repository, worktreeId, "Chat")
    ).rejects.toThrow("Production Workgrove is already using this worktree");
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally {
    try {
      await controller.stopAppGroup(repository, worktreeId, "Chat");
    } catch {
      // The preflight should prevent a run from existing.
    }
    await controller.close();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);
