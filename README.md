# Workgrove

Workgrove is a local, macOS-first control center for Git worktrees. It assigns
stable port slots, starts and stops independent app groups, detects listeners,
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
  "version": 2,
  "setup": { "argv": ["bun", "install"] },
  "appGroups": {
    "Product Apps": {
      "slot": { "default": 0, "stride": 10 },
      "start": { "argv": ["bun", "run", "dev:workgrove"] },
      "stop": "process",
      "apps": {
        "Web": { "basePort": 3000 },
        "API": { "basePort": 8000 }
      }
    },
    "Local Infrastructure": {
      "slot": { "default": 0, "stride": 10 },
      "start": { "argv": ["docker", "compose", "up", "-d"] },
      "stop": { "argv": ["docker", "compose", "down"] },
      "apps": { "Postgres": { "basePort": 5432 } }
    }
  },
  "env": {
    "WEB_PORT": "{appGroups.Product Apps.apps.Web.port}",
    "DATABASE_URL": "{appGroups.Local Infrastructure.apps.Postgres.url}"
  }
}
```

`setup` is the finite command that prepares a worktree. Each exact key in
`appGroups` is also its display name and defines an independently startable and
stoppable group. Commands always run from the selected worktree root.

With `"stop": "process"`, Start must be a foreground command. Workgrove owns the
resulting process and Stop terminates it. Alternatively, `stop` can be a finite
repository command. This is useful for detached infrastructure: status comes
from the configured listening endpoints, Start is idempotent when they already
listen, and Stop runs the command for that group and slot regardless of which
worktree originally started it.

Each app is an observable endpoint with a slot-zero `basePort`. The configurable
group's `stride` is the offset between its slots, so base port 8000 with stride 10
resolves to 8000, 8010, and 8020 for slots 0, 1, and 2. Each worktree's
assignments are stored in the ignored `.workgrove.local.json` file.
Several worktrees may select the same group and slot; listener/process ownership
determines whether a process-controlled group can be started there.

Setup and lifecycle commands receive the explicit `env` entries. Environment
values may be literals or use exact-name templates:

- `{appGroups.<group name>.slot}`
- `{appGroups.<group name>.apps.<app name>.port}`
- `{appGroups.<group name>.apps.<app name>.url}`

Each app group starts one repository command. A root script can still orchestrate
multiple child apps while Workgrove owns port allocation and, for process groups,
the resulting process.

Workgrove asks you to review and trust setup, Start, and command-based Stop whenever
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
