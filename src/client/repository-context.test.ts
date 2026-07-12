import { describe, expect, it } from "bun:test";

import {
  repositoryPathFromArgs,
  repositoryPathFromSearch,
  repositoryUrl,
} from "../repository-context";

describe("repository context", () => {
  it("round-trips repository paths through shareable URLs", () => {
    const url = repositoryUrl(
      "http://127.0.0.1:3999/",
      "/Users/example/Code/project with spaces"
    );
    expect(url).toBe(
      "http://127.0.0.1:3999/?repo=%2FUsers%2Fexample%2FCode%2Fproject+with+spaces"
    );
    expect(repositoryPathFromSearch(new URL(url).search)).toBe(
      "/Users/example/Code/project with spaces"
    );
  });

  it("prefers an explicit daemon repository over its invocation directory", () => {
    expect(repositoryPathFromArgs(["--repo", "./selected"], "/fallback")).toBe(
      "./selected"
    );
    expect(repositoryPathFromArgs([], "/fallback")).toBe("/fallback");
    expect(
      repositoryPathFromArgs(
        ["--repo", "/script-default", "--repo=/user-selected"],
        "/fallback"
      )
    ).toBe("/user-selected");
  });
});
