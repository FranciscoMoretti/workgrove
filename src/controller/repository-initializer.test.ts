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
      expect(preview.detectedRuntime).toBe("Node.js · bun");
      expect(preview.detectedSetupCommand).toBe("bun install");
      expect(preview.detectedStartCommand).toBe("bun dev");
      expect(preview.config.setup?.argv).toEqual(["bun", "install"]);
      expect(preview.config.start?.argv).toEqual(["bun", "dev"]);
      expect(preview.config.apps.app.basePort).toBeGreaterThanOrEqual(10_000);
      expect(Object.keys(preview.config).sort()).toEqual([
        "$schema",
        "apps",
        "setup",
        "start",
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

  it("creates a runnable starter for a detected Django repository", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-django-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(join(root, "manage.py"), "");
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedSetupCommand).toBeNull();
      expect(preview.config.start?.argv).toEqual([
        "python",
        "manage.py",
        "runserver",
        "127.0.0.1:{port}",
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
      expect(preview.config.start?.argv).toEqual(["docker", "compose", "up"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
