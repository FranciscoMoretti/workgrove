import type { AppEndpointSnapshot } from "../../controller/workspace-snapshot";
import { AppPort } from "./app-port";

function friendlyUrlLabel(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
}

export function AppEndpointLink({ app }: { app: AppEndpointSnapshot }) {
  if (app.open && app.listening && app.url) {
    return (
      <a
        className="underline underline-offset-3"
        href={app.url}
        rel="noreferrer"
        target="_blank"
      >
        {friendlyUrlLabel(app.url)}
      </a>
    );
  }
  if (app.listening && app.directUrl) {
    return (
      <a
        className="underline underline-offset-3"
        href={app.directUrl}
        rel="noreferrer"
        target="_blank"
        title="Open direct endpoint"
      >
        <AppPort port={app.port} />
      </a>
    );
  }
  return <AppPort port={app.port} />;
}
