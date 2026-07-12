# Workgrove standalone v1

Workgrove is a public, repository-agnostic, macOS-first local app for managing
Git worktrees and the development applications running in them.

## Product contract

- Discover every Git worktree without imposing folder-name conventions.
- Use a checked-in, versioned `.workgrove.json` and an ignored
  `.env.worktree.local` slot assignment.
- Resolve and inject each configured app's environment inside Workgrove.
- Support per-app commands by default and a legacy aggregate command when a
  repository already owns orchestration.
- Require explicit trust for repository-supplied commands and invalidate trust
  whenever those commands change.
- Track managed processes globally across repositories and reject foreign port
  collisions before spawning.
- Keep loopback transport and UI concerns outside the controller interface.

## Core interface

```ts
interface WorkgroveController {
  inspect(repositoryPath: string): WorkspaceSnapshot;
  execute(command: WorkgroveCommand): Promise<CommandReceipt>;
  logs(repositoryPath: string, worktreeId: string): string[];
}
```

Configuration resolution, Git commands, listener inspection, process
ownership, trust persistence and slot-file writes remain implementation details
behind this interface.

## Platform and distribution

The first public version targets macOS and uses a Bun-powered local daemon.
Native folder selection and URL opening sit behind a host interface. Process
inspection currently uses `lsof`; another operating system requires a second
adapter and its own ownership tests.

The initial distribution is the public `workgrove` npm package, installed with
`bun add --global workgrove`. Its Bun-powered CLI serves the packaged production
UI. The `workgrove/config` export is the supported seam for Bun-based repository
tooling to load the config and resolve slots, app ports, URLs, and exports. A
compiled binary/Homebrew formula remains a follow-up.
