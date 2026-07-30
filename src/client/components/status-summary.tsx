import { cn } from "../lib/utils";

import type { WorktreeDisplayStatus } from "./app-group-status";

const LABELS: Record<WorktreeDisplayStatus, string> = {
  partial: "Partial",
  running: "Running",
  "setup-failed": "Setup failed",
  "setting-up": "Setting up",
  stopped: "Stopped",
};

export function StatusSummary({
  className,
  status,
}: {
  className?: string;
  status: WorktreeDisplayStatus;
}) {
  return (
    <span className={cn("status-summary", className)} data-status={status}>
      <span aria-hidden="true" className="status-summary-dot" />
      {LABELS[status]}
    </span>
  );
}
