# Workgrove

Workgrove is a local, macOS-first control center for Git worktrees. It assigns
stable port slots, starts and stops each worktree's app group, detects listeners,
and keeps managed logs without requiring terminal juggling.

## Install

Requirements: macOS, Git, Bun 1.3+, and `lsof`.

```sh
bun add --global workgrove
workgrove start --repo /path/to/your/repository
```

Then open <http://127.0.0.1:3999>. Use `workgrove status` and
`workgrove stop` to manage the daemon.

## Repository configuration

Commit `.workgrove.json` at the repository root:

```json
{
  "$schema": "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json",
  "version": 1,
  "setup": { "argv": ["bun", "install"] },
  "start": { "argv": ["bun", "run", "dev"] },
  "apps": {
    "web": { "basePort": 3000 },
    "api": { "basePort": 8000 }
  }
}
```

`setup` is an optional finite command that prepares a worktree. `start` is an
optional foreground command that launches every app as one app group. Workgrove
manages the resulting process tree as a unit, so Stop terminates the whole group
and Restart waits for Stop before launching it again. Commands always run from
the worktree root.

Each app is an observable endpoint with a slot-zero `basePort`. Workgrove uses a
fixed stride of 10, so base port 8000 resolves to 8000, 8010, and 8020 for slots
0, 1, and 2. The slot is stored in the ignored `.env.worktree.local` file as
`WORKGROVE_SLOT`.

The start and setup commands receive the resolved slot and ports automatically:

- `WORKGROVE_SLOT`
- `WORKGROVE_WEB_PORT`
- `WORKGROVE_API_PORT`

Environment names are derived from app identifiers. For example, `api-v1`
becomes `WORKGROVE_API_V1_PORT`. App identifiers must not normalize to the same
environment name, and base ports must be unique.

Workgrove asks you to review and trust the setup and start commands whenever
their command fingerprint changes. When a repository has no configuration, the
initialization dialog can detect conservative setup and start commands for
Node.js, Django, FastAPI, Rust, Go, and Docker Compose projects.

### Repository tooling API

Bun-based scripts can share Workgrove's checked-in configuration contract:

```ts
import {
  findWorkgroveConfig,
  loadWorkgroveConfig,
  resolveWorkgroveAppGroup,
  type WorkgroveConfig,
} from "workgrove/config";
```

The public API exposes configuration schemas and types, discovery/loading, and
app-port resolution. Process ownership, command execution, trust, and controller
internals remain private.

## Development

```sh
bun install
bun run dev
bun run lint
bun run test:types
bun run test
bun run build
```

Git, configuration, port inspection, process ownership, and command rules stay
behind the workspace controller and its internal modules.

## License

Apache-2.0
