import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CODEX_HOOK_EVENTS } from "./codex-hook-activity";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "plugins", "workgrove");

describe("Workgrove Codex plugin", () => {
  it("uses default hook discovery with one fixed fail-open command per event", () => {
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8")
    );
    const configuration = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")
    );

    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest).not.toHaveProperty("skills");
    expect(Object.keys(configuration.hooks).sort()).toEqual(
      [...CODEX_HOOK_EVENTS].sort()
    );
    for (const event of CODEX_HOOK_EVENTS) {
      const groups = configuration.hooks[event];
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks).toEqual([
        {
          command: `"\${PLUGIN_ROOT}/hooks/workgrove-hook" ${event}`,
          timeout: 2,
          type: "command",
        },
      ]);
    }
    expect(
      statSync(join(PLUGIN_ROOT, "hooks", "workgrove-hook")).mode % 0o1000
    ).toBeGreaterThanOrEqual(0o100);
  });
});
