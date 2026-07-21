import { describe, expect, it } from "bun:test";

import { processStartMarker } from "./process-inspection";

describe("process inspection", () => {
  it("returns a stable non-empty identity for the current process", () => {
    const marker = processStartMarker(process.pid);
    expect(marker.length).toBeGreaterThan(0);
    expect(processStartMarker(process.pid)).toBe(marker);
  });
});
