import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { branchbaseJsonSchema } from "../src/config/branchbase-json-schema";

const path = join(
  import.meta.dirname,
  "..",
  "schema",
  "branchbase.schema.json"
);
writeFileSync(path, `${JSON.stringify(branchbaseJsonSchema(), null, 2)}\n`);
