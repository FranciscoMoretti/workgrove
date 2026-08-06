import { describe, expect, it } from "bun:test";

import { repositoryTrustDialogOpen } from "./use-repository-trust";

describe("repository trust dialog", () => {
  it("opens only for an untrusted pending action", () => {
    expect(repositoryTrustDialogOpen(true, false, false)).toBe(false);
    expect(repositoryTrustDialogOpen(true, false, true)).toBe(true);
    expect(repositoryTrustDialogOpen(true, true, true)).toBe(false);
  });
});
