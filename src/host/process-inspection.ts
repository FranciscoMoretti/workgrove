import { spawnSync } from "node:child_process";

export function processStartMarker(pid: number): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}
