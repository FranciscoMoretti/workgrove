import { describe, expect, it } from "bun:test";

import { pendingCommandScopes } from "./use-worktree-command-actions";

const repoPath = "/repo";

describe("pending command scopes", () => {
  it("tracks concurrent commands for separate app groups", () => {
    const scopes = pendingCommandScopes(
      [
        {
          command: "start-apps",
          variables: {
            appGroupName: "Chat",
            repoPath,
            worktreeId: "main",
          },
        },
        {
          command: "start-apps",
          variables: {
            appGroupName: "Website",
            repoPath,
            worktreeId: "main",
          },
        },
      ],
      repoPath
    );

    expect(scopes.appGroups.get("main")).toEqual(new Set(["Chat", "Website"]));
    expect(scopes.allAppGroups).toEqual(new Set());
    expect(scopes.worktrees).toEqual(new Set(["main"]));
  });

  it("separates worktree blocking from app-group loading", () => {
    const scopes = pendingCommandScopes(
      [
        {
          command: "setup-all-apps",
          variables: { repoPath, worktreeIds: ["main"] },
        },
      ],
      repoPath
    );

    expect(scopes.blockedWorktrees).toEqual(new Set(["main"]));
    expect(scopes.allAppGroups).toEqual(new Set());
    expect(scopes.appGroups.size).toBe(0);
  });

  it("marks every group pending for aggregate lifecycle commands", () => {
    const scopes = pendingCommandScopes(
      [
        {
          command: "stop-all-apps",
          variables: { repoPath, worktreeIds: ["main", "feature"] },
        },
      ],
      repoPath
    );

    expect(scopes.allAppGroups).toEqual(new Set(["main", "feature"]));
    expect(scopes.blockedWorktrees).toEqual(new Set(["main", "feature"]));
  });

  it("ignores unrelated commands and repositories", () => {
    const scopes = pendingCommandScopes(
      [
        {
          command: "clear-logs",
          variables: {
            appGroupName: "Chat",
            repoPath,
            worktreeId: "main",
          },
        },
        {
          command: "start-apps",
          variables: {
            appGroupName: "Chat",
            repoPath: "/other",
            worktreeId: "main",
          },
        },
      ],
      repoPath
    );

    expect(scopes.worktrees.size).toBe(0);
  });
});
