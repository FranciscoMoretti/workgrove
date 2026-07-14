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
  it("detects package defaults, previews safely, and never overwrites", () => {
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
      expect(preview.detectedStartCommand).toBe("bun dev");
      expect(preview.config.control?.start?.argv).toEqual(["bun", "dev"]);
      expect(preview.config.control?.setup?.argv).toEqual(["bun", "install"]);
      expect(preview.config.apps.app.port.base).toBeGreaterThanOrEqual(10_000);
      expect(preview.config.ports).toEqual({ slotStride: 10 });
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
      expect(preview.detectedRuntime).toBe("Python · Django");
      expect(preview.config.control?.start?.argv).toEqual([
        "python",
        "manage.py",
        "runserver",
        "127.0.0.1:{port}",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("prefers Compose orchestration in mixed-runtime repositories", () => {
    const root = mkdtempSync(join(tmpdir(), "workgrove-compose-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(join(root, "compose.yaml"), "services: {}\n");
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } })
      );
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedRuntime).toBe("Docker Compose");
      expect(preview.config.control?.start?.argv).toEqual([
        "docker",
        "compose",
        "up",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
