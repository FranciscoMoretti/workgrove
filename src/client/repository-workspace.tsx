import { AlertCircleIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type {
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
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
  appGroupName: string | null
): WorktreeSnapshot | null {
  const group = worktree?.appGroups.find(
    (candidate) => candidate.id === appGroupName
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
  appGroupName: string | null,
  appGroupActionBlocked: (
    worktreeId: string,
    targetAppGroupName: string
  ) => boolean,
  appGroupActionPending: (
    worktreeId: string,
    targetAppGroupName: string
  ) => boolean,
  worktreeActionPending: (worktreeId: string) => boolean
): { blocked: boolean; pending: boolean; worktreePending: boolean } {
  if (!worktree) {
    return { blocked: false, pending: false, worktreePending: false };
  }
  const worktreePending = worktreeActionPending(worktree.id);
  if (!appGroupName) {
    return { blocked: worktreePending, pending: false, worktreePending };
  }
  return {
    blocked: appGroupActionBlocked(worktree.id, appGroupName),
    pending: appGroupActionPending(worktree.id, appGroupName),
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
  const [createOpen, setCreateOpen] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeSnapshot | null>(
    null
  );
  const codex = useCodexIntegration(repoPath);
  const quickRepository = useRepositoryOpen(onOpenRepository);
  const selected =
    data.worktrees.find((worktree) => worktree.id === selectedId) ?? null;
  const selectedAppGroupName = data.primaryAppGroup;
  const selectedForDetails = worktreeForAppGroup(
    selected,
    selectedAppGroupName
  );
  const logs = useLogs(repoPath, selectedId, selectedAppGroupName);
  const repositoryTrust = useRepositoryTrust({
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
    toggleApps,
    worktreeActionPending,
  } = useWorktreeCommandActions({
    primaryAppGroup: data.primaryAppGroup,
    repoPath,
    requestRepositoryTrust: repositoryTrust.requestTrust,
    worktrees: data.worktrees,
  });
  const detailsActionState = selectedAppGroupActionState(
    selectedForDetails,
    selectedAppGroupName,
    appGroupActionBlocked,
    appGroupActionPending,
    worktreeActionPending
  );
  const codexWorktrees = codex.data?.worktrees;

  if (repositoryPage === "settings") {
    return (
      <Suspense fallback={<LoadingWorkspace />}>
        <RepositoryConfigPage
          config={data.config}
          configPath={data.configPath}
          error={commands.updateRepositoryConfig.error}
          key={`config-${data.configRevision}`}
          navigationRequest={repositoryCloseRequest}
          onClose={onCloseSettings}
          onDirtyChange={onSettingsDirtyChange}
          onSave={async (config) => {
            await commands.updateRepositoryConfig.mutateAsync({
              config,
              repoPath,
              revision: data.configRevision,
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
      onCreateAppGroupInstance={createAppGroupInstance}
      onDelete={setDeleteTarget}
      onInspect={setSelectedId}
      onRestartAppGroup={restartAppGroup}
      onRetryAppGroup={retryAppGroup}
      onSelectAppGroupInstance={selectAppGroupInstance}
      onToggleAppGroup={toggleAppGroup}
      selectedId={selectedId}
      worktreeActionPending={worktreeActionPending}
      worktrees={data.worktrees}
    />
  );
  const mainPanel = (
    <div className="workspace-shell flex h-screen min-w-0 flex-col bg-muted/30">
      <Toolbar
        activeRepoPath={repoPath}
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

  return (
    <main className="h-screen overflow-hidden">
      {selectedForDetails ? (
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
              key={selectedForDetails.id}
              onDismiss={() => setSelectedId(null)}
              title="Details unavailable"
            >
              <Suspense fallback={<LoadingWorkspace />}>
                <DetailsPanel
                  actionBlocked={detailsActionState.blocked}
                  actionPending={detailsActionState.pending}
                  clearPending={commands.clearLogs.isPending}
                  codexDiscoveryUnavailable={codex.isError}
                  codexLoading={codex.isLoading}
                  codexTasks={
                    codexWorktrees?.[selectedForDetails.id]?.tasks ?? []
                  }
                  commandActions={commandActions}
                  error={logs.error}
                  loading={logs.isLoading}
                  logs={logs.data ?? []}
                  onClearLogs={() =>
                    commands.clearLogs.mutate({
                      appGroupName: selectedAppGroupName,
                      repoPath,
                      worktreeId: selectedForDetails.id,
                    })
                  }
                  onClose={() => setSelectedId(null)}
                  onDelete={() => setDeleteTarget(selectedForDetails)}
                  onInspect={() => setSelectedId(selectedForDetails.id)}
                  onRetryLogs={() => logs.refetch().then(() => undefined)}
                  onToggleApps={() => toggleApps(selectedForDetails)}
                  worktree={selectedForDetails}
                  worktreeActionPending={detailsActionState.worktreePending}
                />
              </Suspense>
            </RecoveryBoundary>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        mainPanel
      )}
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
              setSelectedId(null);
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
            commands={data.trustCommands}
            error={commands.trustRepository.error}
            onClose={repositoryTrust.dismiss}
            onTrust={() =>
              repositoryTrust.approve(() =>
                commands.trustRepository.mutateAsync({ repoPath })
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
