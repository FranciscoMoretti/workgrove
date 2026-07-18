import type { WorkgroveAppGroup } from "./workgrove-schema";

const TOKEN_PATTERN = /\{([^{}]+)\}/;
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

interface TemplateValue {
  ambiguous: boolean;
  value: string | null;
}

function templateValues(
  appGroups: Record<
    string,
    WorkgroveAppGroup | WorkgroveTemplateContext["appGroups"][string]
  >
): Map<string, TemplateValue> {
  const values = new Map<string, TemplateValue>();
  function add(token: string, value: string | null): void {
    const existing = values.get(token);
    values.set(token, {
      ambiguous: existing !== undefined,
      value: existing?.value ?? value,
    });
  }
  for (const [groupName, group] of Object.entries(appGroups)) {
    const prefix = `appGroups.${groupName}`;
    add(`{${prefix}.slot}`, "slot" in group ? String(group.slot) : null);
    for (const appName of Object.keys(group.apps)) {
      const appPrefix = `${prefix}.apps.${appName}`;
      const app = group.apps[appName];
      add(`{${appPrefix}.port}`, "port" in app ? String(app.port) : null);
      add(`{${appPrefix}.url}`, "url" in app ? app.url : null);
    }
  }
  return values;
}

function replaceKnownTokens(
  template: string,
  values: Map<string, TemplateValue>,
  render: boolean
): { error: string | null; value: string } {
  let value = template;
  const tokens = [...values.keys()].sort(
    (left, right) => right.length - left.length
  );
  for (const token of tokens) {
    if (!value.includes(token)) {
      continue;
    }
    const resolved = values.get(token);
    if (!resolved || resolved.ambiguous) {
      return { error: `Ambiguous template token ${token}`, value };
    }
    if (render && resolved.value === null) {
      return { error: `Unsupported template token ${token}`, value };
    }
    value = value.replaceAll(token, render ? (resolved.value ?? "") : "");
  }
  const unknown = value.match(TOKEN_PATTERN)?.[0];
  if (unknown) {
    return { error: `Unsupported template token ${unknown}`, value };
  }
  if (BRACE_PATTERN.test(value)) {
    return {
      error: "Environment template contains an unmatched or unsupported brace",
      value,
    };
  }
  return { error: null, value };
}

export function workgroveTemplateError(
  template: string,
  appGroups: Record<string, WorkgroveAppGroup>
): string | null {
  return replaceKnownTokens(template, templateValues(appGroups), false).error;
}

export function renderWorkgroveTemplate(
  template: string,
  context: WorkgroveTemplateContext
): string {
  const rendered = replaceKnownTokens(
    template,
    templateValues(context.appGroups),
    true
  );
  if (rendered.error) {
    throw new Error(rendered.error);
  }
  return rendered.value;
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
