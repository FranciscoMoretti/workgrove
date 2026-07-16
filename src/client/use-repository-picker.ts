import { useState } from "react";

import { pickRepository } from "./api";

export function useRepositoryPicker(
  onPick: (path: string) => void | Promise<void>
) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function browse() {
    try {
      setPending(true);
      setError(null);
      const path = await pickRepository();
      if (path) {
        await onPick(path);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open picker"
      );
    } finally {
      setPending(false);
    }
  }

  return { browse, clearError: () => setError(null), error, pending };
}
