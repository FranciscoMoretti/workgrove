# Workgrove

Workgrove coordinates development worktrees and the app groups they expose.

## Language

**Repository command profile**:
The repository-wide definition of the Setup and Start commands Workgrove may run. It applies to every worktree of the repository.

**Setup**:
A finite repository command that prepares a worktree for development. It is separate from the app group's lifecycle.

**App group**:
The configured collection of apps that share one Start, Stop, and Restart lifecycle within a worktree.
_Avoid_: Runtime

**App**:
An observable endpoint in an app group, identified by a base port from which Workgrove derives its worktree-specific port.

**Start**:
The repository command that launches an app group for a worktree.

**Managed process tree**:
The process tree launched by Start and owned by Workgrove for one worktree.
_Avoid_: Managed runtime

**Stop**:
The lifecycle action that terminates a worktree's managed process tree without running a repository command.

**Restart**:
The lifecycle action that completes Stop and then performs Start for the same worktree.
