import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  initializeRepository,
  planRepositoryInitialization,
} from "./repository-initializer";

describe("repository initialization", () => {
  it("detects one setup command, one start command, and one app", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-initialize-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.3.0",
          scripts: { dev: "vite" },
        })
      );
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedRuntime).toBe("Node.js · npm");
      expect(preview.detectedSetupCommand).toBe("npm install");
      expect(preview.detectedStartCommand).toBe("npm run dev");
      expect(preview.config.setup.argv).toEqual(["npm", "install"]);
      expect(preview.config.appGroups.Apps.start.argv).toEqual([
        "npm",
        "run",
        "dev",
      ]);
      expect(
        preview.config.appGroups.Apps.apps.App.basePort
      ).toBeGreaterThanOrEqual(10_000);
      expect(Object.keys(preview.config).sort()).toEqual([
        "$schema",
        "appGroups",
        "setup",
        "version",
      ]);
      expect(() => readFileSync(preview.configPath)).toThrow();

      const created = initializeRepository(root);
      expect(JSON.parse(readFileSync(created.configPath, "utf8"))).toEqual(
        created.config
      );
      expect(readFileSync(join(root, ".git/info/exclude"), "utf8")).toContain(
        ".env.worktree.local"
      );
      expect(() => initializeRepository(root)).toThrow("already exists");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("uses safe command defaults when project detection has no commands", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-django-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(join(root, "manage.py"), "");
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedSetupCommand).toBe("npm install");
      expect(preview.detectedStartCommand).toBe("npm run dev");
      expect(preview.config.setup.argv).toEqual(["npm", "install"]);
      expect(preview.config.appGroups.Apps.start.argv).toEqual([
        "npm",
        "run",
        "dev",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("uses the same repository start field for Docker Compose", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-compose-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(join(root, "compose.yaml"), "services: {}\n");
      const preview = planRepositoryInitialization(root);
      expect(preview.config.appGroups.Apps.start.argv).toEqual([
        "docker",
        "compose",
        "up",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
