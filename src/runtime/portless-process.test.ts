import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PortlessProcess } from "./portless-process";

const MISSING_EXECUTABLE_ERROR = /ENOENT/;

it("reports the execution error when Portless cannot be spawned", () => {
  const temporary = mkdtempSync(join(tmpdir(), "workgrove-portless-process-"));

  try {
    const proxy = new PortlessProcess({
      nodePath: join(temporary, "missing-node"),
      port: 13_555,
      stateDirectory: temporary,
    });

    expect(() => proxy.run(["proxy", "start"])).toThrow(
      MISSING_EXECUTABLE_ERROR
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
