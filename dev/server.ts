import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { WorkspaceController } from "../src/controller/workspace-controller";
import { createWorkgroveServer } from "../src/server/workgrove-server";
import { openDevelopmentSession } from "./development-session";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const session = await openDevelopmentSession({ appRoot });
let server: Awaited<ReturnType<typeof createWorkgroveServer>> | undefined;

try {
  const activeServer = await createWorkgroveServer({
    appRoot,
    codexControlDirectory: session.profile.codexControlDirectory,
    controller: new WorkspaceController(undefined, session.controllerRuntime),
    development: true,
    host: "127.0.0.1",
    port: session.profile.dashboardPort,
  });
  server = activeServer;
  process.once("exit", () => {
    try {
      session.close();
    } catch {
      // Process exit still releases resources already cleaned up by the OS.
    }
  });
  console.log(`Workgrove: ${await activeServer.listen()}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      activeServer
        .close()
        .finally(() => session.close())
        .catch(() => {
          process.exitCode = 1;
        });
    });
  }
} catch (error) {
  try {
    await server?.close();
  } catch {
    // Preserve the startup failure after attempting every owned cleanup.
  }
  try {
    session.close();
  } catch {
    // Preserve the startup failure after attempting every owned cleanup.
  }
  throw error;
}
