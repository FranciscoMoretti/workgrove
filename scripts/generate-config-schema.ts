import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { workgroveJsonSchema } from "../src/config/workgrove-json-schema";

const path = join(import.meta.dirname, "..", "schema", "workgrove.schema.json");
writeFileSync(path, `${JSON.stringify(workgroveJsonSchema(), null, 2)}\n`);
