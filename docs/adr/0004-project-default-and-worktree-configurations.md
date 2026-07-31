# ADR 0004: Select configuration per worktree

Status: Accepted on 2026-07-31.

BranchBase treats the Primary worktree's `.branchbase.json` as the Project default and stores a user-local preference for each worktree to inherit that default or read its own checked-in file. This makes configuration experiments deliberate and isolated without introducing merge semantics or duplicating repository commands in local state.

If a selected worktree configuration is missing or invalid, BranchBase visibly falls back to the Project default while preserving the preference so the experiment can recover when the file is fixed. Configuration-source changes are blocked only while that worktree owns active lifecycle state. A run owned by another worktree does not block the change.

Selectable app-group instances are shared only within the same Effective-configuration command fingerprint. Reusing an app-group ID in an incompatible configuration therefore creates a separate instance namespace instead of allowing one worktree to inspect or operate another contract's run.

Trust remains attached to the Project, but both command authorization and approval are scoped to the target worktree's Effective configuration. The trust dialog submits the exact fingerprints it displayed, and approval fails if the checked-in commands changed while the dialog was open. It persists only those reviewed fingerprints. The local trust store retains every explicitly approved fingerprint so approving an experiment does not discard approval of the default contract, and an unapproved experiment does not block an already approved default worktree.

This decision narrows ADR 0002's single checked-in source of truth: configuration content still comes only from `.branchbase.json`, while local state may choose which worktree's checked-in file supplies one worktree's Effective configuration.
