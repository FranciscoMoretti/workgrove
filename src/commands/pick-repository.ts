import { currentHost } from "../host/host-adapter";

export interface PickRepositoryResult {
  path: string | null;
}

export function pickRepository(): PickRepositoryResult {
  return { path: currentHost().pickRepository() };
}
