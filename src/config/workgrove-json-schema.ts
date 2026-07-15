import { z } from "zod";

import { WorkgroveConfigSchema } from "./workgrove-schema";

const SCHEMA_ID =
  "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json";

export function workgroveJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(WorkgroveConfigSchema),
    $id: SCHEMA_ID,
    title: "Workgrove configuration",
    description:
      "Configure one repository setup command, one app-group start command, and the base port of each observable app.",
  };
}
