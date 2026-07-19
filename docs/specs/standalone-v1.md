# Workgrove standalone v1

Workgrove is a public, repository-agnostic, macOS-first local app for managing
Git worktrees and the development applications running in them.

## Product contract

- Discover every Git worktree without imposing folder-name conventions.
- Use a checked-in, versioned `.workgrove.json`; keep machine-local endpoint
  identity, backing-port leases, and active-run state outside the repository.
- Allocate collision-free backing endpoints at Start time instead of assigning
  worktrees or App groups to fixed slots.
- Give HTTP Apps stable Friendly URLs backed by Portless routes and keep direct
  backing URLs diagnostic-only.
- Resolve and inject each App group's configured environment inside Workgrove.
- Support one repository-level Setup command and independently managed App
  groups with process- or command-based Stop behavior.
- Require explicit trust for each repository command fingerprint.
- Track managed processes globally across repositories and quarantine foreign
  endpoint ownership before publishing routes.
- Keep Git, configuration, routing, readiness, process ownership, trust, and
  host-dependent behavior behind `WorkspaceController` or its internal seams.
- Project persisted Codex tasks for every worktree, open them through direct
  `codex://` links, and accept optional authenticated lifecycle hooks for live
  task activity and opt-in Workgrove context sharing.

## Core interface

```ts
interface WorkgroveController {
  inspect(repositoryPath: string): WorkspaceSnapshot;
  execute(command: WorkgroveCommand): Promise<CommandReceipt>;
  logs(repositoryPath: string, worktreeId: string): string[];
}
```

Configuration resolution, Git commands, listener inspection, process
ownership, trust persistence, endpoint state, route publication, readiness,
and Codex discovery remain implementation details behind this interface.

## Platform and distribution

The first public version targets macOS and uses a Bun-powered local daemon.
Native folder selection and URL opening sit behind a host interface. Process
inspection currently uses `lsof`; another operating system requires a second
adapter and its own ownership tests.

The initial distribution is the public `workgrove` npm package, installed with
`bun add --global workgrove`. Its Bun-powered CLI serves the packaged production
UI. The `workgrove/config` export is the supported seam for Bun-based repository
tooling to load slot-free configuration and resolve commands against an active
run's endpoint values. A compiled binary/Homebrew formula remains a follow-up.
