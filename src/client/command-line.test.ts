import { describe, expect, it } from "bun:test";

import { formatCommandLine, parseCommandLine } from "./command-line";

describe("command line fields", () => {
  it("parses ordinary repository commands", () => {
    expect(parseCommandLine("bun install")).toEqual(["bun", "install"]);
    expect(parseCommandLine("bun run dev:all")).toEqual([
      "bun",
      "run",
      "dev:all",
    ]);
  });

  it("round-trips quoted arguments without invoking a shell", () => {
    const argv = ["tool", "argument with spaces", "it's", ""];
    expect(parseCommandLine(formatCommandLine(argv))).toEqual(argv);
  });

  it("rejects incomplete quoting", () => {
    expect(() => parseCommandLine("bun 'install")).toThrow("unclosed");
    expect(() => parseCommandLine("bun install\\")).toThrow("escape");
  });
});
