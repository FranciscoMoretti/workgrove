import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createWorkgroveServer } from "./workgrove-server";

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const server = await createWorkgroveServer({
  appRoot,
  ...(process.env.WORKGROVE_CODEX_CONTROL_DIR
    ? { codexControlDirectory: process.env.WORKGROVE_CODEX_CONTROL_DIR }
    : {}),
  development: process.env.NODE_ENV !== "production",
  host: "127.0.0.1",
  port: Number(process.env.WORKGROVE_PORT ?? 3999),
});

console.log(`Workgrove: ${await server.listen()}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
