import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { WorkspaceController } from "../controller/workspace-controller";
import { openRuntimeProfile } from "../runtime/runtime-profile";
import { createWorkgroveServer } from "./workgrove-server";

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const development = process.env.NODE_ENV !== "production";
const runtime = await openRuntimeProfile({ appRoot, development });
let server: Awaited<ReturnType<typeof createWorkgroveServer>> | undefined;
try {
  const activeServer = await createWorkgroveServer({
    appRoot,
    codexControlDirectory: runtime.profile.codexControlDirectory,
    controller: new WorkspaceController(undefined, runtime.controllerRuntime),
    development,
    host: "127.0.0.1",
    onClose: () => Promise.resolve().then(() => runtime.close()),
    port: runtime.profile.dashboardPort,
  });
  server = activeServer;
  process.once("exit", () => {
    try {
      runtime.close();
    } catch {
      // Process exit still releases any resources that were cleaned up first.
    }
  });
  const listeningUrl = await activeServer.listen();
  console.log(`Workgrove: ${listeningUrl}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      activeServer.close().catch(() => {
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
    runtime.close();
  } catch {
    // Preserve the startup failure after attempting every owned cleanup.
  }
  throw error;
}
