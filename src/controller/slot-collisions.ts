import {
  type WorkgroveConfig,
  workgroveSlotsHavePortCollision,
} from "../config/workgrove-schema";

export function conflictingWorkgroveSlotIndexes(
  config: Pick<WorkgroveConfig, "apps" | "ports">,
  slots: Array<number | null>
): Set<number> {
  const conflicting = new Set<number>();
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    const leftSlot = slots[leftIndex];
    if (leftSlot === null) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < slots.length;
      rightIndex += 1
    ) {
      const rightSlot = slots[rightIndex];
      if (
        rightSlot !== null &&
        workgroveSlotsHavePortCollision(config, leftSlot, rightSlot)
      ) {
        conflicting.add(leftIndex);
        conflicting.add(rightIndex);
      }
    }
  }
  return conflicting;
}

export function workgroveSlotCollisionOwners<Owner extends { slot: number }>(
  config: Pick<WorkgroveConfig, "apps" | "ports">,
  candidateSlot: number,
  assigned: Owner[]
): Owner[] {
  return assigned.filter(({ slot }) =>
    workgroveSlotsHavePortCollision(config, candidateSlot, slot)
  );
}
