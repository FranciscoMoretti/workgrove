import { Fragment } from "react";

import { cn } from "../lib/utils";

export function AppPort({
  className,
  port,
}: {
  className?: string;
  port: number | null;
}) {
  return (
    <code className={cn("font-mono tabular-nums", className)}>
      {port ?? "—"}
    </code>
  );
}

export function AppPortList({
  apps,
}: {
  apps: readonly { label: string; port: number }[];
}) {
  return apps.map((app, index) => (
    <Fragment key={`${app.label}:${app.port}`}>
      {index === 0 ? null : " · "}
      {app.label} <AppPort port={app.port} />
    </Fragment>
  ));
}
