import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

export function acquireExclusiveFileLock(file: string): () => void {
  if (process.platform !== "darwin") {
    throw new Error("Workgrove file locking requires macOS");
  }
  const result = spawnSync(
    "/usr/bin/shlock",
    ["-f", file, "-p", String(process.pid)],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error("Workgrove development profile ownership is busy");
  }
  return () => {
    try {
      if (Number(readFileSync(file, "utf8").trim()) === process.pid) {
        rmSync(file, { force: true });
      }
    } catch {
      // A missing or replaced lock is not owned by this process.
    }
  };
}
