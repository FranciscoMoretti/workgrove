const TOKEN_PATTERN = /\{([^{}]+)\}/g;
const APP_TOKEN_PATTERN = /^apps\.([A-Za-z0-9_-]+)\.(port|url)$/;
const BRACE_PATTERN = /[{}]/;

export interface WorkgroveTemplateContext {
  apps: Record<string, { port: number; url: string }>;
  slot: number;
}

export function workgroveTemplateError(
  template: string,
  appIds: ReadonlySet<string>
): string | null {
  let error: string | null = null;
  const remainder = template.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (token === "slot") {
      return "";
    }
    const appToken = APP_TOKEN_PATTERN.exec(token);
    if (!appToken) {
      error ??= `Unsupported template token {${token}}`;
      return "";
    }
    if (!appIds.has(appToken[1])) {
      error ??= `Template references unknown app "${appToken[1]}"`;
    }
    return "";
  });
  if (!error && BRACE_PATTERN.test(remainder)) {
    return "Environment template contains an unmatched brace";
  }
  return error;
}

export function renderWorkgroveTemplate(
  template: string,
  context: WorkgroveTemplateContext
): string {
  const error = workgroveTemplateError(
    template,
    new Set(Object.keys(context.apps))
  );
  if (error) {
    throw new Error(error);
  }
  return template.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (token === "slot") {
      return String(context.slot);
    }
    const appToken = APP_TOKEN_PATTERN.exec(token);
    if (!appToken) {
      throw new Error(`Unsupported template token {${token}}`);
    }
    return String(context.apps[appToken[1]][appToken[2] as "port" | "url"]);
  });
}

export function renameWorkgroveAppTemplateReferences(
  template: string,
  previousId: string,
  nextId: string
): string {
  return template.replaceAll(`{apps.${previousId}.`, `{apps.${nextId}.`);
}
