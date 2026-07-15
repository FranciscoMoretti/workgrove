import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  FolderGit2Icon,
  FolderOpenIcon,
  TreesIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import type {
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import { repositoryPathFromSearch, repositoryUrl } from "../repository-context";
import { CreateWorktreeDialog } from "./components/create-worktree-dialog";
import { DeleteWorktreeDialog } from "./components/delete-worktree-dialog";
import { DetailsPanel } from "./components/details-panel";
import { RecoveryBoundary } from "./components/recovery-boundary";
import { RepositoryConfigDialog } from "./components/repository-config-dialog";
import { RepositoryDialog } from "./components/repository-dialog";
import { RepositoryTrustDialog } from "./components/repository-trust-dialog";
import { Toolbar } from "./components/toolbar";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/ui/empty";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./components/ui/input-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { Spinner } from "./components/ui/spinner";
import { WorktreeTable } from "./components/worktree-table";
import { useLogs, useWorkspace } from "./queries";
import { useRepositoryOpen } from "./use-repository-open";
import { useRepositoryPicker } from "./use-repository-picker";
import { useRepositorySetup } from "./use-repository-setup";
import { useRepositoryTrust } from "./use-repository-trust";
import { useWorktreeCommandActions } from "./use-worktree-command-actions";

const REPO_STORAGE_KEY = "workgrove:repo-path";
const RECENTS_STORAGE_KEY = "workgrove:recent-repos";
const DETAILS_PANEL_IDS = ["worktrees", "details"];
const EMPTY_WORKTREES: WorktreeSnapshot[] = [];

function recentRepositories(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function Onboarding({
  initialError,
  onDraftChange,
  onOpened,
  recents,
  repoDraft,
}: {
  initialError: Error | null;
  onDraftChange: (value: string) => void;
  onOpened: (path: string, snapshot: WorkspaceSnapshot) => void;
  recents: string[];
  repoDraft: string;
}) {
  const opener = useRepositoryOpen(onOpened, initialError);
  function changeDraft(path: string) {
    opener.clearError();
    picker.clearError();
    onDraftChange(path);
  }
  async function openSelected(path: string) {
    changeDraft(path);
    await opener.open(path);
  }
  const picker = useRepositoryPicker(openSelected);
  const setup = useRepositorySetup({
    error: opener.error,
    onCreated: () => opener.open(repoDraft.trim()),
    repoPath: repoDraft.trim(),
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const path = repoDraft.trim();
    if (!path) {
      return;
    }
    await opener.open(path);
  }
  function feedback() {
    if (setup.active) {
      return setup.notice();
    }
    const message = opener.error?.message ?? picker.error;
    return message ? <FieldError>{message}</FieldError> : null;
  }
  return (
    <main className="grid min-h-screen place-items-center bg-muted p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <EmptyMedia variant="icon">
            <TreesIcon />
          </EmptyMedia>
          <CardTitle>Keep every branch in its lane.</CardTitle>
          <CardDescription>
            Choose a Git repository. Workgrove will discover its worktrees from
            an existing <code>.workgrove.json</code>, or help you create a safe
            starter configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="onboarding-repo-path">
                  Repository path
                </FieldLabel>
                <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderGit2Icon />
                    </InputGroupAddon>
                    <InputGroupInput
                      autoFocus
                      disabled={opener.pending || picker.pending}
                      id="onboarding-repo-path"
                      onChange={(event) => changeDraft(event.target.value)}
                      placeholder="/Users/you/code/project"
                      value={repoDraft}
                    />
                  </InputGroup>
                  <Button
                    aria-label="Choose repository folder"
                    disabled={opener.pending || picker.pending}
                    onClick={picker.browse}
                    variant="outline"
                  >
                    <FolderOpenIcon data-icon="inline-start" />
                    {picker.pending ? "Opening…" : "Browse"}
                  </Button>
                </div>
              </Field>
              {feedback()}
              <Button
                className="w-full"
                disabled={
                  repoDraft.trim() === "" || opener.pending || picker.pending
                }
                type="submit"
              >
                {opener.pending ? "Inspecting…" : "Open repository"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        {recents.length > 0 ? (
          <CardFooter className="flex-col items-stretch gap-1">
            <FieldLabel>Recent repositories</FieldLabel>
            {recents.map((path) => (
              <Button
                className="w-full justify-start truncate"
                disabled={opener.pending || picker.pending}
                key={path}
                onClick={() => openSelected(path)}
                variant="ghost"
              >
                <FolderGit2Icon data-icon="inline-start" />
                {path}
              </Button>
            ))}
          </CardFooter>
        ) : null}
      </Card>
      {setup.dialog}
    </main>
  );
}

export function App() {
  const [repoPath, setRepoPath] = useState(
    () => repositoryPathFromSearch(window.location.search) ?? ""
  );
  const [recents, setRecents] = useState(recentRepositories);
  const [repoDraft, setRepoDraft] = useState(
    () =>
      repositoryPathFromSearch(window.location.search) ??
      localStorage.getItem(REPO_STORAGE_KEY) ??
      ""
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryConfigOpen, setRepositoryConfigOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeSnapshot | null>(
    null
  );
  const workspace = useWorkspace(repoPath);
  const queryClient = useQueryClient();
  const logs = useLogs(repoPath, selectedId);
  const quickRepository = useRepositoryOpen(openRepository);
  const selected =
    workspace.data?.worktrees.find((worktree) => worktree.id === selectedId) ??
    null;
  const visibleWorktrees = workspace.data?.worktrees ?? EMPTY_WORKTREES;
  const repositoryTrust = useRepositoryTrust({
    repoPath,
    required: workspace.data?.trustRequired ?? false,
    trusted: workspace.data?.trusted ?? true,
  });
  const worktreeActions = useWorktreeCommandActions({
    onSelectWorktree: setSelectedId,
    repoPath,
    requestRepositoryTrust: repositoryTrust.requestTrust,
    setupAvailable: workspace.data?.setupAvailable ?? false,
    worktrees: visibleWorktrees,
  });
  const { commandActions, commands, pendingIds, toggleApps, visibleActions } =
    worktreeActions;

  function selectRepository(path: string) {
    const nextRecents = [
      path,
      ...recents.filter((item) => item !== path),
    ].slice(0, 5);
    localStorage.setItem(REPO_STORAGE_KEY, path);
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(nextRecents));
    setRecents(nextRecents);
    window.history.replaceState(
      null,
      "",
      repositoryUrl(window.location.href, path)
    );
    setRepoDraft(path);
    setRepoPath(path);
  }
  function openRepository(path: string, snapshot: WorkspaceSnapshot) {
    queryClient.setQueryData(["workspace", path], snapshot);
    selectRepository(path);
  }
  if (!repoPath || (!workspace.data && workspace.isError)) {
    return (
      <Onboarding
        initialError={workspace.error}
        onDraftChange={setRepoDraft}
        onOpened={openRepository}
        recents={recents}
        repoDraft={repoDraft}
      />
    );
  }
  if (!workspace.data) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Inspecting worktrees</EmptyTitle>
            <EmptyDescription>
              Reading repository configuration and active processes.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    );
  }
  const data = workspace.data;
  function worktreeTable() {
    return (
      <WorktreeTable
        actionPending={(id) => pendingIds.has(id)}
        commandActions={commandActions}
        defaultSlot={data.defaultSlot}
        onDelete={setDeleteTarget}
        onInspect={setSelectedId}
        onSetSlot={(worktree, option) =>
          commands.setSlot.mutate({
            repoPath,
            slot: option.slot,
            worktreeId: worktree.id,
          })
        }
        onToggleApps={toggleApps}
        selectedId={selectedId}
        slots={data.slotOptions}
        visibleActions={visibleActions}
        worktrees={visibleWorktrees}
      />
    );
  }
  const mainPanel = (
    <div className="workspace-shell flex h-screen min-w-0 flex-col bg-muted/30">
      <Toolbar
        activeRepoPath={repoPath}
        isFetching={workspace.isFetching}
        mainWorktreePath={data.mainWorktreePath}
        onConfigure={() => setRepositoryConfigOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onOpenRepository={() => setRepositoryOpen(true)}
        onRefresh={() =>
          Promise.all([
            workspace.refetch(),
            selectedId ? logs.refetch() : Promise.resolve(),
          ]).then(() => undefined)
        }
        onSelectRepository={(path) => {
          if (path !== repoPath) {
            return quickRepository.open(path);
          }
          return undefined;
        }}
        recentRepositories={recents}
        repoName={data.repoName}
        updatedAt={workspace.dataUpdatedAt}
      />
      {commands.error || quickRepository.error ? (
        <Alert className="mx-5 mb-3 w-auto shrink-0" variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Command failed</AlertTitle>
          <AlertDescription>
            {(commands.error ?? quickRepository.error)?.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="worktree-region min-h-0 flex-1 overflow-hidden px-5 pb-5">
        {worktreeTable()}
      </section>
    </div>
  );
  return (
    <main className="h-screen overflow-hidden">
      {selected ? (
        <ResizablePanelGroup
          autoSaveId="workgrove:details-layout:v2"
          className="h-full"
          direction="horizontal"
          panelIds={DETAILS_PANEL_IDS}
        >
          <ResizablePanel defaultSize="50%" id="worktrees" minSize="30%">
            {mainPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="50%"
            id="details"
            maxSize="70%"
            minSize="30%"
          >
            <RecoveryBoundary
              description="The worktree details panel failed, but the workspace table is still available."
              dismissLabel="Close details"
              key={selected.id}
              onDismiss={() => setSelectedId(null)}
              title="Details unavailable"
            >
              <DetailsPanel
                actionPending={pendingIds.has(selected.id)}
                clearPending={commands.clearLogs.isPending}
                commandActions={commandActions}
                error={logs.error}
                loading={logs.isLoading}
                logs={logs.data ?? []}
                onClearLogs={() =>
                  commands.clearLogs.mutate({
                    repoPath,
                    worktreeId: selected.id,
                  })
                }
                onClose={() => setSelectedId(null)}
                onDelete={() => setDeleteTarget(selected)}
                onInspect={() => setSelectedId(selected.id)}
                onRetryLogs={() => logs.refetch().then(() => undefined)}
                onToggleApps={() => toggleApps(selected)}
                worktree={selected}
              />
            </RecoveryBoundary>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        mainPanel
      )}
      <CreateWorktreeDialog
        mutation={commands.createWorktree}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        repoName={data.repoName}
        repoPath={repoPath}
        requestRepositoryTrust={repositoryTrust.requestTrust}
        slots={data.slotOptions}
      />
      <RepositoryDialog
        currentPath={repoPath}
        key={repositoryOpen ? "repository-open" : "repository-closed"}
        onClose={() => setRepositoryOpen(false)}
        onConfirm={(path, snapshot) => {
          openRepository(path, snapshot);
          setSelectedId(null);
        }}
        open={repositoryOpen}
      />
      <RepositoryConfigDialog
        config={data.config}
        configPath={data.configPath}
        error={commands.updateRepositoryConfig.error}
        key={
          repositoryConfigOpen
            ? `config-${data.configRevision}`
            : "config-closed"
        }
        onClose={() => setRepositoryConfigOpen(false)}
        onSave={async (config) => {
          await commands.updateRepositoryConfig.mutateAsync({
            config,
            repoPath,
            revision: data.configRevision,
          });
          setRepositoryConfigOpen(false);
        }}
        open={repositoryConfigOpen}
        pending={commands.updateRepositoryConfig.isPending}
      />
      <DeleteWorktreeDialog
        key={deleteTarget?.id ?? "no-delete"}
        mutation={commands.deleteWorktree}
        onClose={() => setDeleteTarget(null)}
        open={deleteTarget !== null}
        repoPath={repoPath}
        worktree={deleteTarget}
      />
      <RepositoryTrustDialog
        actionLabel={repositoryTrust.actionLabel}
        commands={data.trustCommands}
        error={commands.trustRepository.error}
        onClose={repositoryTrust.dismiss}
        onTrust={() =>
          repositoryTrust.approve(() =>
            commands.trustRepository.mutateAsync({
              repoPath,
            })
          )
        }
        open={repositoryTrust.open}
        pending={commands.trustRepository.isPending}
        repoPath={repoPath}
      />
    </main>
  );
}
