import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceSnapshot } from "../controller/workspace-snapshot";
import {
  repositoryPageFromSearch,
  repositoryPathFromSearch,
  repositoryUrl,
} from "../repository-context";
import { Onboarding } from "./components/onboarding";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/ui/empty";
import { Spinner } from "./components/ui/spinner";
import { useWorkspace } from "./queries";
import { RepositoryWorkspace } from "./repository-workspace";

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

function InspectingWorkspace() {
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
  const [repositoryPage, setRepositoryPage] = useState(() =>
    repositoryPageFromSearch(window.location.search)
  );
  const repositoryPageRef = useRef(repositoryPage);
  repositoryPageRef.current = repositoryPage;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const repositorySettingsDirtyRef = useRef(false);
  const [repositoryCloseRequest, setRepositoryCloseRequest] = useState(0);
  const workspace = useWorkspace(repoPath);
  const queryClient = useQueryClient();

  useEffect(() => {
    function syncLocation(): void {
      const path = repositoryPathFromSearch(window.location.search) ?? "";
      const page = repositoryPageFromSearch(window.location.search);
      if (
        repositoryPageRef.current === "settings" &&
        page !== "settings" &&
        repositorySettingsDirtyRef.current
      ) {
        window.history.pushState(
          null,
          "",
          repositoryUrl(window.location.href, repoPathRef.current, "settings")
        );
        setRepositoryCloseRequest((current) => current + 1);
        return;
      }
      setRepoPath(path);
      setRepoDraft(path);
      setRepositoryPage(page);
    }
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  const handleRepositorySettingsDirtyChange = useCallback((dirty: boolean) => {
    repositorySettingsDirtyRef.current = dirty;
  }, []);

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
    setRepositoryPage("workspace");
  }

  function openRepository(path: string, snapshot: WorkspaceSnapshot) {
    queryClient.setQueryData(["workspace", path], snapshot);
    selectRepository(path);
  }

  function openRepositorySettings(): void {
    window.history.pushState(
      null,
      "",
      repositoryUrl(window.location.href, repoPath, "settings")
    );
    setRepositoryPage("settings");
  }

  function closeRepositorySettings(): void {
    window.history.replaceState(
      null,
      "",
      repositoryUrl(window.location.href, repoPath, "workspace")
    );
    setRepositoryPage("workspace");
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
    return <InspectingWorkspace />;
  }
  return (
    <RepositoryWorkspace
      data={workspace.data}
      dataUpdatedAt={workspace.dataUpdatedAt}
      isFetching={workspace.isFetching}
      onCloseSettings={closeRepositorySettings}
      onOpenRepository={openRepository}
      onOpenSettings={openRepositorySettings}
      onSettingsDirtyChange={handleRepositorySettingsDirtyChange}
      recents={recents}
      refetchWorkspace={() => workspace.refetch()}
      repoPath={repoPath}
      repositoryCloseRequest={repositoryCloseRequest}
      repositoryPage={repositoryPage}
    />
  );
}
