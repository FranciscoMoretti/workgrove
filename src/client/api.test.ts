import { afterEach, describe, expect, it } from "bun:test";

import { fetchCodexIntegration } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Codex integration client", () => {
  it("loads the separately validated projection for a repository", async () => {
    const requests: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      requests.push(String(input));
      return Promise.resolve(
        Response.json({
          updatedAt: "2026-07-18T13:00:00.000Z",
          worktrees: { worktree: { tasks: [] } },
        })
      );
    }) as typeof fetch;

    await expect(fetchCodexIntegration("/repo with space")).resolves.toEqual({
      updatedAt: "2026-07-18T13:00:00.000Z",
      worktrees: { worktree: { tasks: [] } },
    });
    expect(requests).toEqual(["/api/codex?repoPath=%2Frepo+with+space"]);
  });
});
