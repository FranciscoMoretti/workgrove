import { z } from "zod";

import { BranchBaseConfigSchema } from "./branchbase-schema";

const SCHEMA_ID =
  "https://raw.githubusercontent.com/FranciscoMoretti/BranchBase/main/schema/branchbase.schema.json";

export function branchbaseJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(BranchBaseConfigSchema, { io: "input" }),
    $id: SCHEMA_ID,
    title: "BranchBase configuration",
    description:
      "Configure repository commands, dynamic App endpoints, readiness, and exposed App-group environments.",
  };
}
