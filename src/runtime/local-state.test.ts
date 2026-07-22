import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileWorkgroveStateStore } from "./local-state";

const COLLISION_SAFE_HOSTNAME = /^web-[a-f0-9]{6}\.main\.chat-js\.localhost$/;

function request(
  overrides: Partial<Parameters<FileWorkgroveStateStore["instance"]>[0]> = {}
) {
  return {
    groupId: "development",
    mode: "per-worktree" as const,
    repoLabel: "chat-js",
    repoPath: "/code/one/chat-js",
    worktreeLabel: "main",
    worktreePath: "/code/one/chat-js",
    ...overrides,
  };
}

describe("Workgrove local App-group instance state", () => {
  it("creates one stable instance and Friendly hostname per worktree", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const statePath = join(directory, "state.json");
      const firstStore = new FileWorkgroveStateStore(statePath);
      const instance = firstStore.instance(request());
      const first = firstStore.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "development",
        instanceId: instance.id,
        repoPath: "/code/one/chat-js",
      });
      const restoredStore = new FileWorkgroveStateStore(statePath);
      const restoredInstance = restoredStore.instance(
        request({ worktreeLabel: "renamed-main" })
      );
      const restored = restoredStore.endpoint({
        appId: "web",
        appLabel: "Renamed Web",
        groupId: "development",
        instanceId: restoredInstance.id,
        repoPath: "/code/one/chat-js",
      });

      expect(restoredInstance.id).toBe(instance.id);
      expect(restored).toEqual(first);
      expect(first.hostname).toBe("web.main.chat-js.localhost");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("shares selectable instances and lets one worktree select a secondary instance", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const store = new FileWorkgroveStateStore(join(directory, "state.json"));
      const mainRequest = request({
        groupId: "services",
        mode: "selectable",
      });
      const featureRequest = request({
        groupId: "services",
        mode: "selectable",
        worktreeLabel: "feature",
        worktreePath: "/code/one/chat-js-feature",
      });
      const shared = store.instance(mainRequest);
      expect(store.instance(featureRequest).id).toBe(shared.id);

      const experiment = store.createSelectableInstance(
        featureRequest,
        "Migration experiment"
      );
      expect(store.instance(featureRequest).id).toBe(experiment.id);
      expect(store.instance(mainRequest).id).toBe(shared.id);
      expect(store.instances(mainRequest.repoPath, "services")).toEqual([
        expect.objectContaining({ id: shared.id, name: "Default" }),
        expect.objectContaining({
          id: experiment.id,
          name: "Migration experiment",
        }),
      ]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("reserves the automatic selectable instance name", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const store = new FileWorkgroveStateStore(join(directory, "state.json"));
      const selectable = request({
        groupId: "services",
        mode: "selectable",
      });

      expect(() =>
        store.createSelectableInstance(selectable, "default")
      ).toThrow('Instance name "Default" is reserved');
      expect(store.instance(selectable).name).toBe("Default");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("persists an automatically assigned port on the instance endpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const statePath = join(directory, "state.json");
      const store = new FileWorkgroveStateStore(statePath);
      const instance = store.instance(request());
      store.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "development",
        instanceId: instance.id,
        repoPath: request().repoPath,
      });
      store.assignEndpointPort(
        { instanceId: instance.id, repoPath: request().repoPath },
        "web",
        43_127
      );

      const restored = new FileWorkgroveStateStore(statePath).instance(
        request()
      );
      expect(Object.values(restored.endpoints)[0]?.port).toBe(43_127);
      expect(store.leasedPorts()).toEqual(new Set([43_127]));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps hostnames unique when per-worktree groups reuse an App label", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const store = new FileWorkgroveStateStore(join(directory, "state.json"));
      const first = store.instance(request({ groupId: "product" }));
      const second = store.instance(request({ groupId: "admin" }));
      const firstEndpoint = store.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "product",
        instanceId: first.id,
        repoPath: request().repoPath,
      });
      const secondEndpoint = store.endpoint({
        appId: "web",
        appLabel: "Web",
        groupId: "admin",
        instanceId: second.id,
        repoPath: request().repoPath,
      });

      expect(firstEndpoint.hostname).toBe("web.main.chat-js.localhost");
      expect(secondEndpoint.hostname).not.toBe(firstEndpoint.hostname);
      expect(secondEndpoint.hostname).toMatch(COLLISION_SAFE_HOSTNAME);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("persists v1 migration before returning generated instance identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "workgrove-state-"));
    try {
      const statePath = join(directory, "state.json");
      writeFileSync(
        statePath,
        JSON.stringify({
          repositories: {
            [request().repoPath]: {
              id: "repository",
              path: request().repoPath,
              routeLabel: "chat-js",
              worktrees: {
                [request().worktreePath]: {
                  endpoints: {
                    "development\0web": {
                      appId: "web",
                      groupId: "development",
                      hostname: "web.main.chat-js.localhost",
                      id: "endpoint",
                      routeLabel: "web",
                    },
                  },
                  id: "worktree",
                  path: request().worktreePath,
                  routeLabel: "main",
                  runs: {},
                },
              },
            },
          },
          version: 1,
        })
      );

      const store = new FileWorkgroveStateStore(statePath);
      const instance = store.instance(request());
      expect(
        store.endpoint({
          appId: "web",
          appLabel: "Web",
          groupId: "development",
          instanceId: instance.id,
          repoPath: request().repoPath,
        }).hostname
      ).toBe("web.main.chat-js.localhost");
      expect(JSON.parse(readFileSync(statePath, "utf8")).version).toBe(2);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
