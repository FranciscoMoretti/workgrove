import type { WorkgroveAppGroup } from "./workgrove-schema";

const TOKEN_PATTERN = /\{([^{}]+)\}/g;
const BRACE_PATTERN = /[{}]/;

export interface WorkgroveTemplateContext {
  appGroups: Record<
    string,
    {
      apps: Record<string, { port: number; url: string }>;
      slot: number;
    }
  >;
}

function templateValues(
  appGroups: Record<
    string,
    WorkgroveAppGroup | WorkgroveTemplateContext["appGroups"][string]
  >
): Map<string, string | null> {
  const values = new Map<string, string | null>();
  for (const [groupName, group] of Object.entries(appGroups)) {
    const prefix = `appGroups.${groupName}`;
    values.set(`${prefix}.slot`, "slot" in group ? String(group.slot) : null);
    for (const appName of Object.keys(group.apps)) {
      const appPrefix = `${prefix}.apps.${appName}`;
      const app = group.apps[appName];
      values.set(`${appPrefix}.port`, "port" in app ? String(app.port) : null);
      values.set(`${appPrefix}.url`, "url" in app ? app.url : null);
    }
  }
  return values;
}

export function workgroveTemplateError(
  template: string,
  appGroups: Record<string, WorkgroveAppGroup>
): string | null {
  const values = templateValues(appGroups);
  let error: string | null = null;
  const remainder = template.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (!values.has(token)) {
      error ??= `Unsupported template token {${token}}`;
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
  const values = templateValues(context.appGroups);
  return template.replace(TOKEN_PATTERN, (_match, token: string) => {
    const value = values.get(token);
    if (value === undefined || value === null) {
      throw new Error(`Unsupported template token {${token}}`);
    }
    return value;
  });
}

export function renameWorkgroveAppTemplateReferences(
  template: string,
  groupName: string,
  previousId: string,
  nextId: string
): string {
  return template.replaceAll(
    `{appGroups.${groupName}.apps.${previousId}.`,
    `{appGroups.${groupName}.apps.${nextId}.`
  );
}

export function renameWorkgroveAppGroupTemplateReferences(
  template: string,
  previousName: string,
  nextName: string
): string {
  return template.replaceAll(
    `{appGroups.${previousName}.`,
    `{appGroups.${nextName}.`
  );
}
