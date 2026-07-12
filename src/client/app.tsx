import { useQueryClient } from "@tanstack/react-query";
import { FolderGit2Icon, FolderOpenIcon, TreesIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type {
  SlotOption,
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import { appsAreStopped } from "../controller/workspace-snapshot";
import { repositoryPathFromSearch, repositoryUrl } from "../repository-context";
import { CreateWorktreeDialog } from "./components/create-worktree-dialog";
import { DeleteWorktreeDialog } from "./components/delete-worktree-dialog";
import { DetailsPanel } from "./components/details-panel";
import { RepositoryDialog } from "./components/repository-dialog";
import { SlotDialog } from "./components/slot-dialog";
import { Toolbar } from "./components/toolbar";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { WorktreeTable } from "./components/worktree-table";
import { useCommands } from "./mutations";
import { useLogs, useWorkspace } from "./queries";
import { useRepositoryOpen } from "./use-repository-open";
import { useRepositoryPicker } from "./use-repository-picker";
import { useRepositorySetup } from "./use-repository-setup";

const REPO_STORAGE_KEY = "workgrove:repo-path";
const RECENTS_STORAGE_KEY = "workgrove:recent-repos";

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
  const picker = useRepositoryPicker(changeDraft);
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
    return message ? <p className="field-error">{message}</p> : null;
  }
  return (
    <main className="onboarding">
      <div className="onboarding-card">
        <span className="hero-mark">
          <TreesIcon />
        </span>
        <p className="eyebrow">Local worktree control</p>
        <h1>Keep every branch in its lane.</h1>
        <p className="lede">
          Choose a Git repository. Workgrove will discover its worktrees from an
          existing <code>.workgrove.json</code>, or help you create a safe
          starter configuration.
        </p>
        <form onSubmit={submit}>
          <div className="repo-field">
            <label htmlFor="onboarding-repo-path">Repository path</label>
            <div className="repository-path-control">
              <div className="path-input">
                <FolderGit2Icon />
                <Input
                  autoFocus
                  disabled={opener.pending || picker.pending}
                  id="onboarding-repo-path"
                  onChange={(event) => changeDraft(event.target.value)}
                  placeholder="/Users/you/code/project"
                  value={repoDraft}
                />
              </div>
              <Button
                aria-label="Choose repository folder"
                className="browse-button"
                disabled={opener.pending || picker.pending}
                onClick={picker.browse}
                variant="secondary"
              >
                <FolderOpenIcon />
                {picker.pending ? "Opening…" : "Browse"}
              </Button>
            </div>
          </div>
          {feedback()}
          <Button
            className="wide"
            disabled={
              repoDraft.trim() === "" || opener.pending || picker.pending
            }
            type="submit"
          >
            {opener.pending ? "Inspecting…" : "Open repository"}
          </Button>
        </form>
        {recents.length > 0 ? (
          <div className="recent-repos">
            <span>Recent repositories</span>
            {recents.map((path) => (
              <Button
                className="recent-repository"
                disabled={opener.pending || picker.pending}
                key={path}
                onClick={() => changeDraft(path)}
                variant="ghost"
              >
                <FolderGit2Icon />
                {path}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {setup.dialog}
    </main>
  );
}

function RepositoryTrustNotice({
  commands,
  onTrust,
  pending,
}: {
  commands: string[];
  onTrust: () => void;
  pending: boolean;
}) {
  return (
    <div className="trust-banner">
      <div>
        <strong>Trust repository commands?</strong>
        <span>{commands.join(" · ")}</span>
      </div>
      <Button disabled={pending} onClick={onTrust} size="sm">
        {pending ? "Trusting…" : "Trust commands"}
      </Button>
    </div>
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
  const [slotChoice, setSlotChoice] = useState<{
    option: SlotOption;
    worktree: WorktreeSnapshot;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeSnapshot | null>(
    null
  );
  const workspace = useWorkspace(repoPath);
  const queryClient = useQueryClient();
  const commands = useCommands(repoPath);
  const logs = useLogs(repoPath, selectedId);
  const quickRepository = useRepositoryOpen(openRepository);
  const selected =
    workspace.data?.worktrees.find((worktree) => worktree.id === selectedId) ??
    null;
  const visibleWorktrees = workspace.data?.worktrees ?? [];
  const pendingIds = useMemo(
    () =>
      new Set(
        [
          commands.startApps.variables?.worktreeId,
          commands.stopApps.variables?.worktreeId,
          commands.restartApps.variables?.worktreeId,
          commands.setSlot.variables?.worktreeId,
          commands.deleteWorktree.variables?.worktreeId,
        ].filter((id): id is string => typeof id === "string")
      ),
    [
      commands.deleteWorktree.variables,
      commands.setSlot.variables,
      commands.restartApps.variables,
      commands.startApps.variables,
      commands.stopApps.variables,
    ]
  );

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
      <main className="loading-screen">
        <TreesIcon className="pulse" />
        <p>Inspecting worktrees…</p>
      </main>
    );
  }
  const data = workspace.data;
  const visibleIds = visibleWorktrees.map((worktree) => worktree.id);
  const bulkPending =
    commands.restartRunningApps.isPending ||
    commands.setupAllApps.isPending ||
    commands.startAllApps.isPending ||
    commands.stopAllApps.isPending;
  function toggleApps(worktree: WorktreeSnapshot) {
    const mutation = appsAreStopped(worktree)
      ? commands.startApps
      : commands.stopApps;
    mutation.mutate({ repoPath, worktreeId: worktree.id });
    setSelectedId(worktree.id);
  }
  function restartApps(worktree: WorktreeSnapshot) {
    commands.restartApps.mutate({ repoPath, worktreeId: worktree.id });
    setSelectedId(worktree.id);
  }
  function worktreeTable() {
    return (
      <WorktreeTable
        actionPending={(id) => pendingIds.has(id)}
        defaultSlot={data.defaultSlot}
        onDelete={setDeleteTarget}
        onInspect={setSelectedId}
        onRestartApps={restartApps}
        onSetSlot={(worktree, option) => setSlotChoice({ option, worktree })}
        onToggleApps={toggleApps}
        selectedId={selectedId}
        slots={data.slotOptions}
        visibleActions={{
          onRestart: () =>
            commands.restartRunningApps.mutate({
              repoPath,
              worktreeIds: visibleIds,
            }),
          onSetup: () =>
            commands.setupAllApps.mutate({ repoPath, worktreeIds: visibleIds }),
          onStart: () =>
            commands.startAllApps.mutate({ repoPath, worktreeIds: visibleIds }),
          onStop: () =>
            commands.stopAllApps.mutate({ repoPath, worktreeIds: visibleIds }),
          pending: bulkPending,
          setupAvailable: data.setupAvailable,
        }}
        worktrees={visibleWorktrees}
      />
    );
  }
  const mainPanel = (
    <div className="main-panel">
      <Toolbar
        activeRepoPath={repoPath}
        globalProcesses={data.globalProcesses}
        isFetching={workspace.isFetching}
        mainWorktreePath={data.mainWorktreePath}
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
        <div className="error-banner">
          {(commands.error ?? quickRepository.error)?.message}
        </div>
      ) : null}
      {data.trustRequired && !data.trusted ? (
        <RepositoryTrustNotice
          commands={data.trustCommands}
          onTrust={() =>
            commands.trustRepository.mutate({
              fingerprint: data.trustFingerprint,
              repoPath,
            })
          }
          pending={commands.trustRepository.isPending}
        />
      ) : null}
      <section className="workspace-main">{worktreeTable()}</section>
    </div>
  );
  return (
    <main className="app-shell">
      {selected ? (
        <ResizablePanelGroup
          autoSaveId="workgrove:details-layout"
          className="app-layout"
          direction="horizontal"
        >
          <ResizablePanel defaultSize={58} minSize={38}>
            {mainPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} maxSize={62} minSize={32}>
            <DetailsPanel
              actionPending={pendingIds.has(selected.id)}
              clearPending={commands.clearLogs.isPending}
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
              onRestart={() => restartApps(selected)}
              onRetryLogs={() => logs.refetch().then(() => undefined)}
              onToggleApps={() => toggleApps(selected)}
              worktree={selected}
            />
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
      <SlotDialog
        key={
          slotChoice
            ? `${slotChoice.worktree.id}:${slotChoice.option.slot}`
            : "no-slot"
        }
        mutation={commands.setSlot}
        onClose={() => setSlotChoice(null)}
        open={slotChoice !== null}
        option={slotChoice?.option ?? null}
        repoPath={repoPath}
        worktree={slotChoice?.worktree ?? null}
      />
      <DeleteWorktreeDialog
        key={deleteTarget?.id ?? "no-delete"}
        mutation={commands.deleteWorktree}
        onClose={() => setDeleteTarget(null)}
        open={deleteTarget !== null}
        repoPath={repoPath}
        worktree={deleteTarget}
      />
    </main>
  );
}
