# Workgrove

Workgrove is a macOS-first control center for local development across many Git
worktrees. It keeps each worktree's apps, ports, processes, logs, and Codex tasks
in one place, so parallel work does not turn into a collection of terminals and
forgotten conversations.

Use it when you regularly create worktrees, run several copies of the same app,
or have multiple Codex tasks working in the same repository.

## What it gives you

- One dashboard for every worktree in a repository.
- Independently startable app groups, such as product apps and local
  infrastructure.
- Stable per-worktree ports, listener detection, process ownership, and managed
  logs.
- Command review and trust before repository setup or lifecycle commands run.
- Every non-archived Codex task associated with each exact worktree path.
- Direct **Open task** and **New task** links into the Codex desktop app.
- Optional live Codex activity and automatic Workgrove context through the
  bundled plugin.

The core model is:

```text
repository
  -> worktrees
       -> app groups
            -> apps, ports, processes, and logs
       -> associated Codex tasks
```

## Quick start

### Requirements

- Core Workgrove: macOS, Git, [Bun](https://bun.sh/) 1.3 or newer, and `lsof`
  (included with macOS).
- Codex task discovery: a compatible Codex CLI or ChatGPT desktop app bundle.
- **Open task** and **New task**: ChatGPT desktop, which handles `codex://`
  links.
- Live status and automatic context: the bundled Workgrove plugin installed in
  Codex, with its hooks trusted.

Codex is optional, and the integration does not require an OpenAI API key.

### Run the current integration from `main`

The Codex integration is currently available from `main`:

```sh
git clone https://github.com/FranciscoMoretti/workgrove.git
cd workgrove
bun install --frozen-lockfile
bun run build
bun scripts/daemon.ts start --repo /path/to/your/repository
```

Open <http://127.0.0.1:3999>. Workgrove will inspect the repository's worktrees
and ask you to review any repository commands before trusting them.

Use these commands to manage the source-run daemon:

```sh
bun scripts/daemon.ts status
bun scripts/daemon.ts stop
```

### Install the published core package

The current `workgrove@0.4.0` package provides core worktree and process
management but predates the Codex integration:

```sh
bun add --global workgrove
workgrove start --repo /path/to/your/repository
workgrove status
workgrove stop
```

## Codex integration

Workgrove matches Codex tasks to worktrees using the task's exact canonical
working directory. It exposes every matching non-archived top-level task; the
UI may emphasize the newest one, but the backend does not discard the others.

### Task discovery and desktop links

No plugin is required for the basic integration:

1. Start Workgrove for a repository.
2. Open that repository in the dashboard.
3. Select a worktree to see all of its associated Codex tasks.
4. Use **Open task** to continue an existing conversation or **New task** to
   open Codex at that worktree's path.

Workgrove starts a private `codex app-server` process and decodes only task
names, IDs, timestamps, Git metadata, and exact working directories. Although a
task-list response can contain a preview, Workgrove does not retain, project, or
expose it, and it never requests full turns or transcripts with `thread/read`.
If task discovery is unavailable, the rest of Workgrove continues to work; the
**New task** link is still rendered and works when ChatGPT desktop is installed.

### Optional live status and automatic context

Install the bundled Workgrove plugin to add **Working**, **Waiting for
approval**, **Ready**, and **Unknown** activity plus automatic Workgrove context:

```sh
codex plugin marketplace add FranciscoMoretti/workgrove --ref main
codex plugin add workgrove@workgrove
```

Then restart the ChatGPT desktop app, keep the Workgrove daemon running, and
open or resume a Codex task at a worktree whose root contains a valid
`.workgrove.json`. Review and trust the Workgrove plugin hooks when Codex asks.

The context uses an explicit allowlist: canonical worktree path, branch, app and
group labels, ports, URLs, and process/readiness state. This helps Codex use the
correct running app instead of starting a competing server. Managed logs,
environment values, repository command definitions, prompts, transcripts, and
tool arguments or results are omitted. Hooks are fail-open: if Workgrove is
stopped or the plugin is disabled, Codex continues normally and live activity
eventually becomes Unknown.

See the official [Codex plugin](https://learn.chatgpt.com/docs/plugins) and
[hook](https://learn.chatgpt.com/docs/hooks) documentation for the underlying
installation and trust model.

## Repository configuration

Commit `.workgrove.json` at the repository root. The setup command prepares one
worktree; each app group can then be started and stopped independently.

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

Important configuration behavior:

- Commands are argv arrays and run from the selected worktree root.
- With `"stop": "process"`, Start must remain in the foreground. Workgrove owns
  that process and terminates it on Stop.
- A command-based Stop is useful for detached infrastructure such as Docker
  Compose.
- `basePort + slot * stride` gives each worktree a separate app port.
- Local slot assignments live in the ignored `.workgrove.local.json` file.
- Environment values can be literals or exact-name templates such as
  `{appGroups.Product Apps.apps.Web.port}` and
  `{appGroups.Product Apps.apps.Web.url}`.

If a repository has no configuration, Workgrove can suggest conservative setup
and start commands for Node.js, Django, FastAPI, Rust, Go, and Docker Compose.
You still review and trust the resulting command fingerprint before it runs.

### Repository tooling API

Bun scripts can reuse Workgrove's checked-in configuration contract:

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
behind `WorkspaceController` and its internal modules.

## License

Apache-2.0
