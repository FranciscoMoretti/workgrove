import { describe, expect, it } from "bun:test";

import type { WorkgroveConfig } from "../config/workgrove-schema";
import {
  type ConfigDraftStorage,
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "./config-draft";

function createConfig(): WorkgroveConfig {
  return {
    setup: { argv: ["npm", "install"] },
    appGroups: {
      Apps: {
        slot: { default: 0, stride: 10 },
        start: { argv: ["bun", "run", "dev"] },
        stop: "process",
        apps: { web: { basePort: 3000 } },
      },
    },
    version: 2,
  };
}

function createMemoryStorage(): ConfigDraftStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("configuration drafts", () => {
  it("restores an in-progress draft, including invalid numeric input", () => {
    const source = createConfig();
    const draft = {
      ...source,
      appGroups: {
        Apps: {
          ...source.appGroups.Apps,
          apps: { web: { basePort: Number.NaN } },
        },
      },
    };
    const storage = createMemoryStorage();

    saveConfigDraft("/repo/.workgrove.json", source, draft, storage);

    const restored = loadConfigDraft("/repo/.workgrove.json", source, storage);
    expect(restored).not.toBeNull();
    expect(Number.isNaN(restored?.appGroups.Apps.apps.web.basePort)).toBe(true);

    clearConfigDraft("/repo/.workgrove.json", storage);
    expect(
      loadConfigDraft("/repo/.workgrove.json", source, storage)
    ).toBeNull();
  });

  it("drops a draft when the configuration changed outside the editor", () => {
    const source = createConfig();
    const storage = createMemoryStorage();

    saveConfigDraft(
      "/repo/.workgrove.json",
      source,
      {
        ...source,
        appGroups: {
          Apps: { ...source.appGroups.Apps, apps: { web: { basePort: 3100 } } },
        },
      },
      storage
    );

    const changedSource = {
      ...source,
      appGroups: {
        Apps: { ...source.appGroups.Apps, apps: { web: { basePort: 4000 } } },
      },
    };
    expect(
      loadConfigDraft("/repo/.workgrove.json", changedSource, storage)
    ).toBeNull();
    expect(
      loadConfigDraft("/repo/.workgrove.json", source, storage)
    ).toBeNull();
  });

  it("drops a legacy draft that omitted a now-required command", () => {
    const source = createConfig();
    const storage = createMemoryStorage();

    saveConfigDraft(
      "/repo/.workgrove.json",
      source,
      { ...source, setup: undefined },
      storage
    );

    expect(
      loadConfigDraft("/repo/.workgrove.json", source, storage)
    ).toBeNull();
    expect(
      loadConfigDraft("/repo/.workgrove.json", source, storage)
    ).toBeNull();
  });

  it("ignores malformed stored data", () => {
    const source = createConfig();
    const storage = createMemoryStorage();
    storage.setItem("workgrove:configuration-draft:/repo/.workgrove.json", "{");

    expect(
      loadConfigDraft("/repo/.workgrove.json", source, storage)
    ).toBeNull();
  });

  it("continues without recovery when browser storage is unavailable", () => {
    const unavailableStorage: ConfigDraftStorage = {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      removeItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    };

    expect(
      loadConfigDraft(
        "/repo/.workgrove.json",
        createConfig(),
        unavailableStorage
      )
    ).toBeNull();
    expect(() =>
      saveConfigDraft(
        "/repo/.workgrove.json",
        createConfig(),
        createConfig(),
        unavailableStorage
      )
    ).not.toThrow();
    expect(() =>
      clearConfigDraft("/repo/.workgrove.json", unavailableStorage)
    ).not.toThrow();
  });
});
