# Workgrove

Workgrove coordinates development worktrees and the app groups they expose.

## Language

**Setup**:
A finite repository command that prepares a worktree for development. It is separate from the app group's lifecycle.

**App group**:
The named collection of apps that share one Start, Stop, slot, and Restart lifecycle. Its configuration key is its exact display name.
_Avoid_: Runtime

**App**:
An observable endpoint in an app group, identified by a base port from which Workgrove derives its worktree-specific port.

**Stride**:
An app group's port offset between consecutive slots.

**Repository environment**:
The explicit environment variables Workgrove derives from all group slots and app endpoints and supplies to Setup and lifecycle commands.

**Start**:
The repository command that launches an app group for a selected worktree and slot.

**Process**:
The foreground process launched by Start and owned by Workgrove for one worktree and app group.

**Stop**:
Either `process`, which terminates the process Workgrove launched, or a finite repository command for a listener-observed group shared by slot.

**Restart**:
The lifecycle action that completes Stop and then performs Start for the same worktree, group, and slot.

**Slot assignment**:
The app-group-specific slot selected by a worktree. Assignments need not be unique; runtime status and process ownership determine whether the slot is usable.
