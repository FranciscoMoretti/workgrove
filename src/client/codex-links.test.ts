import { describe, expect, it } from "bun:test";

import { codexNewTaskUrl, codexOpenTaskUrl } from "./codex-links";

describe("Codex desktop links", () => {
  it("opens a persisted task through its encoded task ID", () => {
    expect(codexOpenTaskUrl("019f76d6-3248-7b82-a2ae-2e20fb560645")).toBe(
      "codex://threads/019f76d6-3248-7b82-a2ae-2e20fb560645"
    );
    expect(codexOpenTaskUrl("task/with spaces?#and-üñicode")).toBe(
      "codex://threads/task%2Fwith%20spaces%3F%23and-%C3%BC%C3%B1icode"
    );
    expect(codexOpenTaskUrl("task!'()*")).toBe(
      "codex://threads/task%21%27%28%29%2A"
    );
  });

  it("starts a task at an encoded absolute worktree path", () => {
    expect(codexNewTaskUrl("/Users/fran/Code/work grove/mañana?#&=%")).toBe(
      "codex://new?path=%2FUsers%2Ffran%2FCode%2Fwork%20grove%2Fma%C3%B1ana%3F%23%26%3D%25"
    );
  });

  it("rejects invalid task IDs instead of creating misleading links", () => {
    expect(codexOpenTaskUrl("")).toBeNull();
    expect(codexOpenTaskUrl("   ")).toBeNull();
    expect(codexOpenTaskUrl(" task-id ")).toBeNull();
    expect(codexOpenTaskUrl("task\u0000id")).toBeNull();
    expect(codexOpenTaskUrl("a".repeat(513))).toBeNull();
    expect(codexOpenTaskUrl("task-\uD800")).toBeNull();
  });

  it("rejects malformed canonical-path values instead of creating links", () => {
    expect(codexNewTaskUrl("")).toBeNull();
    expect(codexNewTaskUrl("   ")).toBeNull();
    expect(codexNewTaskUrl("/worktree\npath")).toBeNull();
    expect(codexNewTaskUrl(`/${"a".repeat(4096)}`)).toBeNull();
    expect(codexNewTaskUrl("/worktree-\uD800")).toBeNull();
  });
});
