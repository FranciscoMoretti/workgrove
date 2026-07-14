const TEMPLATE_PATTERN = /\{([^}]+)\}/g;
const APP_TEMPLATE_PATTERN = /^apps\.([a-zA-Z0-9_-]+)\.(port|url)$/;

export interface WorkgroveTemplateContext {
  apps: Record<string, { port: number; url: string }>;
  port: number;
  slot: number;
  url?: string;
}

export function renderWorkgroveTemplate(
  template: string,
  context: WorkgroveTemplateContext
): string {
  return template.replace(TEMPLATE_PATTERN, (_, token: string) => {
    if (token === "slot") {
      return String(context.slot);
    }
    if (token === "port") {
      return String(context.port);
    }
    if (token === "url" && context.url) {
      return context.url;
    }
    const match = APP_TEMPLATE_PATTERN.exec(token);
    const app = match ? context.apps[match[1]] : null;
    if (match && app) {
      return String(app[match[2] as "port" | "url"]);
    }
    throw new Error(`Unknown Workgrove template variable "${token}"`);
  });
}

export function workgroveTemplateAppReferences(value: string): string[] {
  return workgroveTemplateTokens(value).flatMap((token) => {
    const appId = workgroveTemplateTokenAppReference(token);
    return appId ? [appId] : [];
  });
}

export function workgroveTemplateTokens(value: string): string[] {
  return Array.from(value.matchAll(TEMPLATE_PATTERN), (match) => match[1]);
}

export function workgroveTemplateTokenAppReference(
  token: string
): string | null {
  return APP_TEMPLATE_PATTERN.exec(token)?.[1] ?? null;
}

export function renameWorkgroveTemplateAppReference(
  value: string,
  previousId: string,
  nextId: string
): string {
  return value.replaceAll(`{apps.${previousId}.`, `{apps.${nextId}.`);
}
