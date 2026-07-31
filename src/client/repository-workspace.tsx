import { AlertCircleIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import type {
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import { worktreeHasRunningAppGroups } from "../controller/workspace-snapshot";
import type { RepositoryPage } from "../repository-context";
import { RecoveryBoundary } from "./components/recovery-boundary";
import { Toolbar } from "./components/toolbar";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { Spinner } from "./components/ui/spinner";
import { WorktreeTable } from "./components/worktree-table";
import { useCodexIntegration, useLogs } from "./queries";
import { useRepositoryOpen } from "./use-repository-open";
import { useRepositoryTrust } from "./use-repository-trust";
import { useWorktreeCommandActions } from "./use-worktree-command-actions";

const CreateWorktreeDialog = lazy(() =>
  import("./components/create-worktree-dialog").then((module) => ({
    default: module.CreateWorktreeDialog,
  }))
);
const DeleteWorktreeDialog = lazy(() =>
  import("./components/delete-worktree-dialog").then((module) => ({
    default: module.DeleteWorktreeDialog,
  }))
);
const DetailsPanel = lazy(() =>
  import("./components/details-panel").then((module) => ({
    default: module.DetailsPanel,
  }))
);
const RepositoryConfigPage = lazy(() =>
  import("./components/repository-config-page").then((module) => ({
    default: module.RepositoryConfigPage,
  }))
);
const RepositoryDialog = lazy(() =>
  import("./components/repository-dialog").then((module) => ({
    default: module.RepositoryDialog,
  }))
);
const RepositoryTrustDialog = lazy(() =>
  import("./components/repository-trust-dialog").then((module) => ({
    default: module.RepositoryTrustDialog,
  }))
);

const DETAILS_PANEL_IDS = ["worktrees", "details"];
const NARROW_WORKSPACE_QUERY = "(max-width: 760px)";

function useNarrowWorkspace(): boolean {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(NARROW_WORKSPACE_QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_WORKSPACE_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return narrow;
}

function codexAvailability({
  isError,
  isLoading,
}: {
  isError: boolean;
  isLoading: boolean;
}): "loading" | "ready" | "unavailable" {
  if (isError) {
    return "unavailable";
  }
  return isLoading ? "loading" : "ready";
}

function worktreeForAppGroup(
  worktree: WorktreeSnapshot | null,
  appGroupId: string | null
): WorktreeSnapshot | null {
  const group = worktree?.appGroups.find(
    (candidate) => candidate.id === appGroupId
  );
  if (!(worktree && group)) {
    return worktree;
  }
  return {
    ...worktree,
    appLabel: group.name,
    apps: group.apps,
    health: group.health,
    processRunning: group.processRunning,
  };
}

function selectedAppGroupActionState(
  worktree: WorktreeSnapshot | null,
  appGroupId: string | null,
  appGroupActionBlocked: (
    worktreeId: string,
    targetAppGroupId: string
  ) => boolean,
  appGroupActionPending: (
    worktreeId: string,
    targetAppGroupId: string
  ) => boolean,
  worktreeActionPending: (worktreeId: string) => boolean
): { blocked: boolean; pending: boolean; worktreePending: boolean } {
  if (!worktree) {
    return { blocked: false, pending: false, worktreePending: false };
  }
  const worktreePending = worktreeActionPending(worktree.id);
  if (!appGroupId) {
    return { blocked: worktreePending, pending: false, worktreePending };
  }
  return {
    blocked: appGroupActionBlocked(worktree.id, appGroupId),
    pending: appGroupActionPending(worktree.id, appGroupId),
    worktreePending,
  };
}

function LoadingWorkspace() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Spinner />
    </main>
  );
}

export function RepositoryWorkspace({
  data,
  dataUpdatedAt,
  isFetching,
  onCloseSettings,
  onOpenRepository,
  onOpenSettings,
  onSettingsDirtyChange,
  recents,
  repoPath,
  repositoryCloseRequest,
  repositoryPage,
  refetchWorkspace,
}: {
  data: WorkspaceSnapshot;
  dataUpdatedAt: number;
  isFetching: boolean;
  onCloseSettings: () => void;
  onOpenRepository: (path: string, snapshot: WorkspaceSnapshot) => void;
  onOpenSettings: () => void;
  onSettingsDirtyChange: (dirty: boolean) => void;
  recents: string[];
  repoPath: string;
  repositoryCloseRequest: number;
  repositoryPage: RepositoryPage;
  refetchWorkspace: () => Promise<unknown>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAppGroupId, setSelectedAppGroupId] = useState<string | null>(
    null
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeSnapshot | null>(
    null
  );
  const narrowWorkspace = useNarrowWorkspace();
  const codex = useCodexIntegration(repoPath);
  const quickRepository = useRepositoryOpen(onOpenRepository);
  const selected =
    data.worktrees.find((worktree) => worktree.id === selectedId) ?? null;
  const effectiveAppGroupId =
    selectedAppGroupId ??
    selected?.primaryAppGroup ??
    data.projectDefaultPrimaryAppGroup;
  const selectedAppGroup =
    selected?.appGroups.find((group) => group.id === effectiveAppGroupId) ??
    null;
  const selectedForDetails = selectedAppGroup
    ? worktreeForAppGroup(selected, effectiveAppGroupId)
    : null;
  const logs = useLogs(repoPath, selectedId, effectiveAppGroupId);
  const repositoryTrust = useRepositoryTrust({
    approval: { fingerprint: data.trustFingerprint },
    commands: data.trustCommands,
    repoPath,
    required: data.trustRequired,
    trusted: data.trusted,
  });
  const {
    appGroupActionBlocked,
    appGroupActionPending,
    commandActions,
    commands,
    createAppGroupInstance,
    restartAppGroup,
    retryAppGroup,
    selectAppGroupInstance,
    toggleAppGroup,
    worktreeActionPending,
  } = useWorktreeCommandActions({
    repoPath,
    requestRepositoryTrust: repositoryTrust.requestTrust,
    worktrees: data.worktrees,
  });
  const detailsActionState = selectedAppGroupActionState(
    selectedForDetails,
    effectiveAppGroupId,
    appGroupActionBlocked,
    appGroupActionPending,
    worktreeActionPending
  );
  const codexWorktrees = codex.data?.worktrees;
  const activeWorktreeCount = data.worktrees.filter(
    worktreeHasRunningAppGroups
  ).length;
  function inspectWorktree(worktreeId: string) {
    setSelectedAppGroupId(null);
    setSelectedId(worktreeId);
  }
  function inspectAppGroup(worktreeId: string, appGroupId: string) {
    setSelectedAppGroupId(appGroupId);
    setSelectedId(worktreeId);
  }
  function closeDetails() {
    setSelectedAppGroupId(null);
    setSelectedId(null);
  }

  if (repositoryPage === "settings") {
    return (
      <Suspense fallback={<LoadingWorkspace />}>
        <RepositoryConfigPage
          config={data.projectDefaultConfig}
          configPath={data.projectDefaultConfigPath}
          error={commands.updateRepositoryConfig.error}
          key={`config-${data.projectDefaultConfigRevision}`}
          navigationRequest={repositoryCloseRequest}
          onClose={onCloseSettings}
          onDirtyChange={onSettingsDirtyChange}
          onSave={async (config) => {
            await commands.updateRepositoryConfig.mutateAsync({
              config,
              repoPath,
              revision: data.projectDefaultConfigRevision,
            });
            onCloseSettings();
          }}
          pending={commands.updateRepositoryConfig.isPending}
        />
      </Suspense>
    );
  }

  const table = (
    <WorktreeTable
      appGroupActionBlocked={appGroupActionBlocked}
      appGroupActionPending={appGroupActionPending}
      codexAvailability={codexAvailability(codex)}
      codexWorktrees={codexWorktrees}
      commandActions={commandActions}
      onDelete={setDeleteTarget}
      onInspect={inspectWorktree}
      onInspectAppGroup={inspectAppGroup}
      onRestartAppGroup={restartAppGroup}
      onRetryAppGroup={retryAppGroup}
      onToggleAppGroup={toggleAppGroup}
      selectedId={selectedId}
      worktreeActionPending={worktreeActionPending}
      worktrees={data.worktrees}
    />
  );
  const mainPanel = (
    <div className="workspace-shell brand-canvas flex h-screen min-w-0 flex-col">
      <Toolbar
        activeRepoPath={repoPath}
        activeWorktreeCount={activeWorktreeCount}
        isFetching={isFetching}
        mainWorktreePath={data.mainWorktreePath}
        onConfigure={onOpenSettings}
        onCreate={() => setCreateOpen(true)}
        onOpenRepository={() => setRepositoryOpen(true)}
        onRefresh={() =>
          Promise.all([
            refetchWorkspace(),
            codex.refetch(),
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
        updatedAt={dataUpdatedAt}
        worktreeCount={data.worktrees.length}
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
        {table}
      </section>
    </div>
  );
  const detailsPanel =
    selectedForDetails && selectedAppGroup ? (
      <RecoveryBoundary
        description="The worktree details panel failed, but the workspace table is still available."
        dismissLabel="Close details"
        key={selectedForDetails.id}
        onDismiss={closeDetails}
        title="Details unavailable"
      >
        <Suspense fallback={<LoadingWorkspace />}>
          <DetailsPanel
            actionBlocked={detailsActionState.blocked}
            actionPending={detailsActionState.pending}
            appGroup={selectedAppGroup}
            clearPending={commands.clearLogs.isPending}
            codexDiscoveryUnavailable={codex.isError}
            codexLoading={codex.isLoading}
            codexTasks={codexWorktrees?.[selectedForDetails.id]?.tasks ?? []}
            commandActions={commandActions}
            configSourcePending={commands.selectWorktreeConfigSource.isPending}
            error={logs.error}
            loading={logs.isLoading}
            logs={logs.data ?? []}
            onClearLogs={() =>
              commands.clearLogs.mutate({
                appGroupName: effectiveAppGroupId,
                repoPath,
                worktreeId: selectedForDetails.id,
              })
            }
            onClose={closeDetails}
            onCreateAppGroupInstance={(name) =>
              createAppGroupInstance(selectedForDetails, selectedAppGroup, name)
            }
            onDelete={() => setDeleteTarget(selectedForDetails)}
            onInspect={() =>
              inspectAppGroup(selectedForDetails.id, selectedAppGroup.id)
            }
            onRetryLogs={() => logs.refetch().then(() => undefined)}
            onSelectAppGroupInstance={(instanceId) =>
              selectAppGroupInstance(
                selectedForDetails,
                selectedAppGroup,
                instanceId
              )
            }
            onSelectConfigSource={(source) =>
              commands.selectWorktreeConfigSource.mutate({
                repoPath,
                source,
                worktreeId: selectedForDetails.id,
              })
            }
            onToggleApps={() =>
              toggleAppGroup(selectedForDetails, selectedAppGroup)
            }
            worktree={selectedForDetails}
            worktreeActionPending={detailsActionState.worktreePending}
          />
        </Suspense>
      </RecoveryBoundary>
    ) : null;
  let workspaceContent = mainPanel;
  if (selectedForDetails && narrowWorkspace) {
    workspaceContent = (
      <div className="mobile-details-shell h-full">{detailsPanel}</div>
    );
  } else if (selectedForDetails) {
    workspaceContent = (
      <ResizablePanelGroup
        autoSaveId="branchbase:details-layout:v2"
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
          {detailsPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <main className="h-screen overflow-hidden">
      {workspaceContent}
      {createOpen ? (
        <Suspense fallback={null}>
          <CreateWorktreeDialog
            mutation={commands.createWorktree}
            onClose={() => setCreateOpen(false)}
            repoPath={repoPath}
            requestRepositoryTrust={repositoryTrust.requestTrust}
          />
        </Suspense>
      ) : null}
      {repositoryOpen ? (
        <Suspense fallback={null}>
          <RepositoryDialog
            currentPath={repoPath}
            onClose={() => setRepositoryOpen(false)}
            onConfirm={(path, snapshot) => {
              onOpenRepository(path, snapshot);
              closeDetails();
            }}
          />
        </Suspense>
      ) : null}
      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteWorktreeDialog
            mutation={commands.deleteWorktree}
            onClose={() => setDeleteTarget(null)}
            repoPath={repoPath}
            worktree={deleteTarget}
          />
        </Suspense>
      ) : null}
      {repositoryTrust.open ? (
        <Suspense fallback={null}>
          <RepositoryTrustDialog
            actionLabel={repositoryTrust.actionLabel}
            commands={repositoryTrust.commands}
            error={commands.trustRepository.error}
            onClose={repositoryTrust.dismiss}
            onTrust={() =>
              repositoryTrust.approve(() =>
                commands.trustRepository.mutateAsync({
                  approvals: repositoryTrust.approvals,
                  repoPath,
                })
              )
            }
            open
            pending={commands.trustRepository.isPending}
            repoPath={repoPath}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
