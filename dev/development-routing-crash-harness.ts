import { DevelopmentRouting } from "./development-routing";

const port = Number(process.argv[2]);
const stateDirectory = process.argv[3];
if (!(Number.isInteger(port) && stateDirectory)) {
  throw new Error("Invalid development routing harness configuration");
}

await DevelopmentRouting.open({ port, stateDirectory });
process.send?.({ type: "ready" });
