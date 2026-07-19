import { z } from "zod";

import { WorkgroveConfigSchema } from "./workgrove-schema";

const SCHEMA_ID =
  "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json";

export function workgroveJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(WorkgroveConfigSchema, { io: "input" }),
    $id: SCHEMA_ID,
    title: "Workgrove configuration",
    description:
      "Configure repository commands, dynamic App endpoints, readiness, and exposed App-group environments.",
  };
}
