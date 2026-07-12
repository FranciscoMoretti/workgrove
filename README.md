# Workgrove

Workgrove is a local, macOS-first control center for Git worktrees. It assigns
stable port slots, starts and stops each worktree's configured apps, detects
listeners, and keeps managed logs without requiring terminal juggling.

## Install

Requirements: macOS, Git, Bun 1.3+, and `lsof`.

```sh
bun add --global workgrove
workgrove start --repo /path/to/your/repository
```

Then open <http://127.0.0.1:3999>. Use `workgrove status` and
`workgrove stop` to manage the daemon.

## Repository configuration

Commit `.workgrove.json` at the repository root. Workgrove resolves the slot
stored in each worktree's ignored `.env.worktree.local`, then injects each
app's environment itself.

```json
{
  "$schema": "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json",
  "version": 1,
  "slot": {
    "env": "WORKGROVE_SLOT",
    "default": 0,
    "file": ".env.worktree.local"
  },
  "range": { "base": 4000, "stride": 10 },
  "url": "http://localhost:{port}",
  "apps": {
    "web": {
      "offset": 0,
      "control": {
        "label": "Web",
        "open": true,
        "probe": "tcp",
        "required": true
      },
      "exports": { "PORT": "{port}" },
      "start": {
        "argv": ["npm", "run", "dev"],
        "env": { "PORT": "{port}" }
      }
    }
  },
  "control": {
    "postCreate": { "argv": ["npm", "install"] }
  }
}
```

Workgrove asks you to review and trust executable commands the first time a
repository is opened and whenever those commands change. Older
`.worktree-env.json` files remain readable for migration.

When a repository has no configuration, the initialization dialog can prepare
conservative starters for Node.js, Django, FastAPI, Rust, Go, and Docker
Compose projects. Review the generated command before creating the file;
unknown layouts receive an editable config without an executable command.

Command `argv`, `cwd`, and `env` strings support `{slot}`, `{port}`, `{url}`,
and cross-app templates such as `{apps.api.port}`.

Use exactly one launch mode: either `control.start` for an existing aggregate
orchestration command, or per-app `start` commands. In per-app mode every
required TCP app needs its own start command. These cross-field rules are
enforced by Workgrove in addition to the public JSON Schema.

### Repository tooling API

Bun-based repository scripts can share Workgrove's checked-in configuration
contract instead of maintaining their own port resolver:

```ts
import {
  findWorkgroveConfig,
  loadWorkgroveConfig,
  resolveWorkgroveRuntime,
  type WorkgroveConfig,
} from "workgrove/config";
```

`workgrove/config` intentionally exposes only the configuration schemas and
types, config discovery/loading, and runtime app/port resolution. Process,
trust, command execution, and controller internals are not public APIs.

## Development

```sh
bun install
bun run dev
bun run lint
bun run test:types
bun run test
```

The controller remains the central module: Git, configuration, process
ownership and port state stay behind the same interface used by the local HTTP
server and tests.

## License

Apache-2.0
