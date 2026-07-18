import type { WorkgroveConfig } from "../config/workgrove-schema";

const CONFIG_DRAFT_STORAGE_PREFIX = "workgrove:configuration-draft:";
const NONFINITE_NUMBER_MARKER = "__workgroveNonfiniteNumber";

export interface ConfigDraftStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface StoredConfigDraft {
  draft: string;
  source: string;
}

function isCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>).argv)
  );
}

function hasEditableRequiredCommands(value: unknown): value is WorkgroveConfig {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2 || !isCommand(candidate.setup)) {
    return false;
  }
  const groups = candidate.appGroups;
  if (!(groups && typeof groups === "object" && !Array.isArray(groups))) {
    return false;
  }
  return Object.values(groups).every((group) => {
    if (!(group && typeof group === "object" && !Array.isArray(group))) {
      return false;
    }
    const record = group as Record<string, unknown>;
    return (
      isCommand(record.start) &&
      (record.stop === "process" || isCommand(record.stop))
    );
  });
}

function configDraftStorageKey(configPath: string): string {
  return `${CONFIG_DRAFT_STORAGE_PREFIX}${configPath}`;
}

function stringifyConfigDraft(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) =>
    typeof candidate === "number" && !Number.isFinite(candidate)
      ? { [NONFINITE_NUMBER_MARKER]: String(candidate) }
      : candidate
  );
}

function parseConfigDraft(value: string): unknown {
  return JSON.parse(value, (_key, candidate) => {
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const marker = record[NONFINITE_NUMBER_MARKER];
      if (
        Object.keys(record).length === 1 &&
        (marker === "NaN" || marker === "Infinity" || marker === "-Infinity")
      ) {
        return Number(marker);
      }
    }
    return candidate;
  });
}

export function loadConfigDraft(
  configPath: string,
  source: WorkgroveConfig,
  storage: ConfigDraftStorage = sessionStorage
): WorkgroveConfig | null {
  const key = configDraftStorageKey(configPath);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredConfigDraft;
    if (stored.source !== JSON.stringify(source)) {
      storage.removeItem(key);
      return null;
    }
    const draft = parseConfigDraft(stored.draft);
    if (!hasEditableRequiredCommands(draft)) {
      throw new Error("Invalid stored configuration draft");
    }
    return draft as WorkgroveConfig;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return null;
  }
}

export function saveConfigDraft(
  configPath: string,
  source: WorkgroveConfig,
  draft: unknown,
  storage: ConfigDraftStorage = sessionStorage
): void {
  try {
    storage.setItem(
      configDraftStorageKey(configPath),
      JSON.stringify({
        draft: stringifyConfigDraft(draft),
        source: JSON.stringify(source),
      } satisfies StoredConfigDraft)
    );
  } catch {
    // The close guards still protect the draft when storage is unavailable.
  }
}

export function clearConfigDraft(
  configPath: string,
  storage: ConfigDraftStorage = sessionStorage
): void {
  try {
    storage.removeItem(configDraftStorageKey(configPath));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
