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
  "ports": { "base": 4000, "slotStride": 10 },
  "url": "http://localhost:{port}",
  "apps": {
    "web": {
      "port": { "offset": 0 },
      "control": {
        "label": "Web",
        "open": true,
        "probe": "tcp",
        "required": true
      },
      "exports": { "PORT": "{port}" }
    }
  },
  "control": {
    "setup": { "argv": ["bun", "install"] },
    "start": {
      "argv": ["bun", "dev"],
      "env": { "PORT": "{port}" }
    }
  }
}
```

Apps can either use an offset inside the shared repository range or declare a
conventional slot-zero base port. For example, `"port": { "base": 8000 }`
gives that app ports 8000, 8010, and 8020 for slots 0, 1, and 2 when
`slotStride` is 10. Every app must occupy a distinct port lane modulo the
stride, so its ports cannot collide with another app in a different worktree
slot; with a stride of 10, pair a base of 8000 with offsets 1 through 9 rather
than offset 0.

Workgrove asks you to review and trust executable commands the first time a
repository is opened. Trust is saved for that repository and does not need to
be repeated when its commands change. `.worktree-env.json` remains discoverable
as an alternate filename when it uses the current configuration contract.

When a repository has no configuration, the initialization dialog can prepare
conservative starters for Node.js, Django, FastAPI, Rust, Go, and Docker
Compose projects. Review the generated command before creating the file;
unknown layouts receive an editable config without an executable command.

Command `argv`, `cwd`, and `env` strings support `{slot}`, `{port}`, `{url}`,
and cross-app templates such as `{apps.api.port}`.

Use exactly one launch mode: either the repository-level `control.start`, or
per-app `start` commands when apps need separate processes. In per-app mode
every required TCP app needs its own start command. These cross-field rules are
enforced by Workgrove in addition to the public JSON Schema. The localhost UI
provides repository command fields with `bun install` and `bun dev` placeholders.

`control.setup` is a finite preparation command and can run whether apps are
started or stopped. Stop terminates only the process Workgrove launched for
Start; Restart waits for Stop and then performs Start again. The legacy
`control.postCreate` key remains readable as an alias for `control.setup`.

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
