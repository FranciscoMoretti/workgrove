import type { ReactNode } from "react";
import { useState } from "react";

import { RepositoryInitializeDialog } from "./components/repository-initialize-dialog";
import { RepositorySetupNotice } from "./components/repository-setup-notice";
import { missingConfigPath } from "./repository-open-state";

export function useRepositorySetup({
  error,
  onCreated,
  repoPath,
}: {
  error: Error | null;
  onCreated: () => void | Promise<void>;
  repoPath: string;
}) {
  const [open, setOpen] = useState(false);
  const configPath = missingConfigPath(error);
  function notice(): ReactNode {
    return configPath ? (
      <RepositorySetupNotice
        configPath={configPath}
        onInitialize={() => setOpen(true)}
      />
    ) : null;
  }
  const dialog = (
    <RepositoryInitializeDialog
      key={open ? "initialize-open" : "initialize-closed"}
      onClose={() => setOpen(false)}
      onCreated={async () => {
        setOpen(false);
        await onCreated();
      }}
      open={open}
      repoPath={repoPath}
    />
  );
  return { active: configPath !== null, dialog, notice };
}
