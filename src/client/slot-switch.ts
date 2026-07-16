export interface SlotWorktreeInput extends Record<string, unknown> {
  repoPath: string;
  worktreeId: string;
}

export interface SlotSwitchInput extends SlotWorktreeInput {
  slot: number;
}

interface SlotSwitchActions {
  setSlot: (input: SlotSwitchInput) => Promise<unknown>;
  startApps: (input: SlotWorktreeInput) => Promise<unknown>;
  stopApps: (input: SlotWorktreeInput) => Promise<unknown>;
}

export async function runSlotSwitch(
  actions: SlotSwitchActions,
  input: SlotSwitchInput
): Promise<void> {
  const worktreeInput = {
    repoPath: input.repoPath,
    worktreeId: input.worktreeId,
  };
  await actions.stopApps(worktreeInput);
  await actions.setSlot(input);
  await actions.startApps(worktreeInput);
}
