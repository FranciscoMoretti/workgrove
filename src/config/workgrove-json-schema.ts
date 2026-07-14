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
      "Choose one start mode: either control.start for aggregate orchestration, or per-app start commands. Each app declares its slot-zero base port, and Workgrove applies the shared slot stride.",
  };
}
