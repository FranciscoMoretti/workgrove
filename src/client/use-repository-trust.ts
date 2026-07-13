import { useCallback, useState } from "react";

export type RepositoryTrustAction = () => void | Promise<void>;

export type RequestRepositoryTrust = (
  label: string,
  action: RepositoryTrustAction
) => void;

interface TrustRequest {
  action: RepositoryTrustAction;
  key: string;
  label: string;
}

export function useRepositoryTrust({
  repoPath,
  required,
  trusted,
}: {
  repoPath: string;
  required: boolean;
  trusted: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [request, setRequest] = useState<TrustRequest | null>(null);
  const key = repoPath;
  const currentRequest = request?.key === key ? request : null;
  const open =
    required && !trusted && (currentRequest !== null || !dismissed.has(key));

  const requestTrust = useCallback<RequestRepositoryTrust>(
    (label, action) => {
      if (!(required && !trusted)) {
        Promise.resolve()
          .then(action)
          .catch(() => undefined);
        return;
      }
      setRequest({ action, key, label });
    },
    [key, required, trusted]
  );

  const dismiss = useCallback(() => {
    setDismissed((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setRequest(null);
  }, [key]);

  const approve = useCallback(
    async (authorize: () => Promise<unknown>) => {
      const action = currentRequest?.action ?? null;
      try {
        await authorize();
      } catch {
        return;
      }
      setDismissed((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      setRequest(null);
      try {
        await action?.();
      } catch {
        // The command mutation owns its error state and presentation.
      }
    },
    [currentRequest, key]
  );

  return {
    actionLabel: currentRequest?.label ?? null,
    approve,
    dismiss,
    open,
    requestTrust,
  };
}
