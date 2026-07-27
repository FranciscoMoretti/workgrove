import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
  parseCurrentWorkgroveLocalState,
  type WorkgroveLocalState,
} from "../runtime/local-state";
import {
  inspectListeningPorts,
  listeningPortPids,
  pidOwnedByWorktree,
} from "../runtime/ports";
import {
  appGroupInstanceProcessId,
  ProcessSupervisor,
} from "../runtime/process-supervisor";

type RecordedInstance =
  WorkgroveLocalState["repositories"][string]["instances"][string];

export interface VerifiedWorktreeRun {
  groupId: string;
  pid: number;
  port: number;
  worktreePath: string;
}

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function liveRunEvidence(
  instance: RecordedInstance,
  worktreePath: string,
  processes: ProcessSupervisor,
  ports: ReturnType<typeof inspectListeningPorts>
): Pick<VerifiedWorktreeRun, "pid" | "port"> | null {
  if (
    !instance.run ||
    canonicalPath(instance.run.worktreePath) !== worktreePath
  ) {
    return null;
  }
  const endpointPorts = Object.values(instance.run.apps).map(
    (endpoint) => endpoint.port
  );
  const managedPid = processes.managedPid(
    appGroupInstanceProcessId(instance.id),
    worktreePath
  );
  const listener = endpointPorts
    .flatMap((port) =>
      listeningPortPids(ports, port).map((pid) => ({ pid, port }))
    )
    .find(({ pid }) => pidOwnedByWorktree(pid, worktreePath));
  const pid = managedPid ?? listener?.pid;
  const port = listener?.port ?? endpointPorts[0];
  return pid && port ? { pid, port } : null;
}

export function findVerifiedWorktreeRun(
  controlDirectory: string,
  worktreePathValue: string
): VerifiedWorktreeRun | null {
  const statePath = join(controlDirectory, "state.json");
  if (!existsSync(statePath)) {
    return null;
  }
  const state = parseCurrentWorkgroveLocalState(
    JSON.parse(readFileSync(statePath, "utf8"))
  );
  const worktreePath = realpathSync(worktreePathValue);
  const processes = new ProcessSupervisor(controlDirectory);
  const ports = inspectListeningPorts();

  for (const repository of Object.values(state.repositories)) {
    for (const instance of Object.values(repository.instances)) {
      const evidence = liveRunEvidence(
        instance,
        worktreePath,
        processes,
        ports
      );
      if (evidence) {
        return {
          groupId: instance.groupId,
          ...evidence,
          worktreePath,
        };
      }
    }
  }
  return null;
}
