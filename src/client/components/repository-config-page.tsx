import { ArrowLeftIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type WorkgroveConfig,
  WorkgroveConfigSchema,
} from "../../config/workgrove-schema";
import {
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "../config-draft";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function RepositoryConfigPage({
  config,
  configPath,
  error,
  navigationRequest,
  onClose,
  onDirtyChange,
  onSave,
  pending,
}: {
  config: WorkgroveConfig;
  configPath: string;
  error: Error | null;
  navigationRequest: number;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (value: WorkgroveConfig) => Promise<void>;
  pending: boolean;
}) {
  const original = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const [source, setSource] = useState(
    () => loadConfigDraft(configPath, original) ?? original
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const parsed = useMemo(() => {
    try {
      return WorkgroveConfigSchema.safeParse(JSON.parse(source));
    } catch (caught) {
      return {
        success: false as const,
        message: caught instanceof Error ? caught.message : "Invalid JSON",
      };
    }
  }, [source]);
  const dirty = source !== original;

  useEffect(() => {
    if (dirty) {
      saveConfigDraft(configPath, original, source);
    } else {
      clearConfigDraft(configPath);
    }
  }, [configPath, dirty, original, source]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (navigationRequest > 0 && dirty) {
      setDiscardOpen(true);
    }
  }, [dirty, navigationRequest]);

  let validationMessage: string | null = null;
  if (!parsed.success) {
    validationMessage =
      "message" in parsed
        ? parsed.message
        : parsed.error.issues
            .slice(0, 4)
            .map(
              (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`
            )
            .join("; ");
  }

  function requestClose() {
    if (dirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  }

  async function saveConfiguration(): Promise<void> {
    if (!parsed.success) {
      return;
    }
    await onSave(parsed.data);
    clearConfigDraft(configPath);
  }

  function discardChanges(): void {
    clearConfigDraft(configPath);
    onClose();
  }

  return (
    <main className="flex h-screen min-w-0 flex-col bg-background">
      <header className="shrink-0 border-b bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-start gap-3 px-6 py-5">
          <Button
            aria-label="Back to worktrees"
            onClick={requestClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="font-heading font-medium text-xl">
              Repository settings
            </h1>
            <p className="text-muted-foreground text-sm">
              Checked-in App groups, lifecycle commands, environment templates,
              and readiness.
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
          <div>
            <p className="font-medium">{configPath}</p>
            <p className="text-muted-foreground text-sm">
              HTTP Apps receive stable Friendly URLs and dynamic backing ports.
              Use tokens such as {"{apps.web.port}"} and {"{apps.web.url}"} in
              group environment variables.
            </p>
          </div>
          <Textarea
            aria-label="Workgrove configuration JSON"
            className="min-h-[32rem] font-mono text-sm"
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            value={source}
          />
          {validationMessage ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Configuration needs attention</AlertTitle>
              <AlertDescription>{validationMessage}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Could not save configuration</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
      <footer className="shrink-0 border-t bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2 px-6 py-4">
          {discardOpen ? (
            <>
              <p className="mr-auto text-muted-foreground">
                Discard unsaved configuration changes?
              </p>
              <Button onClick={() => setDiscardOpen(false)} variant="outline">
                Keep editing
              </Button>
              <Button onClick={discardChanges} variant="destructive">
                Discard changes
              </Button>
            </>
          ) : (
            <>
              <Button onClick={requestClose} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={!(dirty && parsed.success) || pending}
                onClick={saveConfiguration}
              >
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
