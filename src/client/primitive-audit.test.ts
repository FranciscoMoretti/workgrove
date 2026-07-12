import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_ROOT = join(import.meta.dir);
const FORBIDDEN_PRIMITIVES =
  /<(button|details|dialog|input|select|summary|textarea)\b/;
const FORBIDDEN_PRIMITIVE_IMPORTS =
  /from ["'](?:@radix-ui\/|react-resizable-panels)/;

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "ui" ? [] : componentFiles(path);
    }
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("client primitive boundary", () => {
  it("routes native interactive elements through components/ui", () => {
    const violations = componentFiles(CLIENT_ROOT)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          FORBIDDEN_PRIMITIVES.test(source) ||
          FORBIDDEN_PRIMITIVE_IMPORTS.test(source)
        );
      })
      .map((file) => relative(CLIENT_ROOT, file));
    expect(violations).toEqual([]);
  });
});
