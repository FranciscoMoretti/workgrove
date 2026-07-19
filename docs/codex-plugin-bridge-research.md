# Trusted Workgrove Codex plugin bridge

Research date: 2026-07-18. Local host inspected: `codex-cli 0.144.2` from the ChatGPT desktop app.

## Decision

Ship the demo as a **personal Codex plugin with default-discovered hooks** and a **separate, scope-limited Workgrove hook capability**:

| Area | Decision |
| --- | --- |
| Plugin layout | `.codex-plugin/plugin.json`, `hooks/hooks.json`, and one bundled hook runner. Do not put `hooks` in `plugin.json` yet. |
| Distribution | Use the personal marketplace for the local demo; the plugin remains globally installed, while each worktree opts in with its own valid root `.workgrove.json`. |
| Trust | Installation/enabling is not hook trust. The user must review and trust the hook definition; changed definitions are skipped until trusted again. |
| Transport | `POST` to a loopback-only hook endpoint using a dedicated rotating bearer capability, not the browser mutation token. |
| Capability | `~/.workgrove/codex/capability.json`; dedicated directory mode `0700`, file mode `0600`, atomic replacement, new 256-bit token on each daemon start. |
| Worktree gate | The server canonicalizes the event `cwd`, resolves its exact Git worktree root, and loads that root's `.workgrove.json` through `WorkspaceController` internals. Missing or invalid config means no recording and no context. |
| Failure policy | Observational and fail-open. A missing daemon, malformed capability, auth failure, invalid worktree, oversized input, or timeout returns no context and never blocks Codex. |
| Privacy | Forward only identifiers/state metadata. Never forward prompts, transcript paths/content, tool arguments/results, assistant messages, logs, environment values, or repository commands. |

This design makes plugin installation the global user opt-in and a valid branch-local `.workgrove.json` the per-worktree opt-in. It keeps Git/config/runtime authority behind `WorkspaceController`, as required by this repository.

## Why a plugin, and how Codex loads it

Codex plugins can bundle lifecycle hooks. The documented conventional layout is:

```text
workgrove/
├── .codex-plugin/
│   └── plugin.json
├── hooks/
│   ├── hooks.json
│   └── workgrove-hook
└── assets/                 # optional later
```

Only `plugin.json` belongs in `.codex-plugin/`; hooks remain at the plugin root. When an enabled plugin contains `hooks/hooks.json`, Codex discovers it automatically. A manifest-level `hooks` entry can override that default, but is unnecessary for this layout. Plugin hook commands receive `PLUGIN_ROOT` (installed bundle) and `PLUGIN_DATA` (writable plugin data), plus compatibility aliases `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`. Paths in the manifest are relative to the plugin root and must stay inside it. [Official plugin structure and path rules](https://learn.chatgpt.com/docs/build-plugins#plugin-structure), [official plugin-hook discovery and environment](https://learn.chatgpt.com/docs/hooks#plugin-bundled-hooks)

Recommended hook command shape:

```json
{
  "type": "command",
  "command": "\"${PLUGIN_ROOT}/hooks/workgrove-hook\" SessionStart",
  "timeout": 2,
  "statusMessage": "Loading Workgrove context"
}
```

Pass the event name as a fixed argument from `hooks.json`. The runner still verifies that it matches `hook_event_name`. This lets it reject unexpectedly large stdin without needing to parse sensitive payloads merely to identify the event. Use a self-contained executable or a runtime already guaranteed by the Workgrove installation; do not assume the desktop app inherits an interactive shell's `PATH`.

### Official docs versus the local validator

There is a concrete tooling conflict:

- Current official documentation lists `hooks` as a valid `plugin.json` component field and shows `"hooks": "./hooks/hooks.json"`. [Official manifest fields](https://learn.chatgpt.com/docs/build-plugins#manifest-fields)
- The bundled plugin-creator reference also shows a `hooks` field, but its validation notes and `validate_plugin.py` reject `hooks` as unsupported. See [`plugin-json-spec.md`](</Users/fran/.codex/skills/.system/plugin-creator/references/plugin-json-spec.md>) and [`validate_plugin.py`](</Users/fran/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py>).

Use the documented default `hooks/hooks.json` discovery and omit the manifest `hooks` field. This is supported by the official host and passes the current local validator. Treat the validator as stale/narrow on this point, not as evidence that Codex lacks manifest hooks.

## Installation, update, enablement, and trust

For the demo, create a personal marketplace entry in `~/.agents/plugins/marketplace.json`. The desktop app reads that default personal marketplace, installs a copy under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`, and records per-plugin enablement in `~/.codex/config.toml`. The installed cache—not the source directory—is the executing plugin root. [Marketplace discovery and installed-copy behavior](https://learn.chatgpt.com/docs/build-plugins#how-the-chatgpt-desktop-app-uses-marketplaces)

The user flow is:

1. Add the Workgrove plugin to the personal marketplace and install it from the desktop Plugins directory (or `codex plugin add workgrove@<marketplace>`).
2. Enable it.
3. Review and trust its hooks. Installation or enablement alone does **not** trust them; untrusted hooks are skipped. Codex records trust against the current hook-definition hash, and changed definitions require review again. The documented CLI review surface is `/hooks`. [Hook trust model](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks), [plugin-bundled hook trust](https://learn.chatgpt.com/docs/build-plugins#bundled-mcp-servers-and-lifecycle-hooks)
4. Start a new Codex task/session to pick up the installed plugin.

For reliable local iteration, use the bundled plugin-creator cachebuster/reinstall flow and then start a new task; do not hand-edit Codex's plugin cache or `config.toml`. See [`installing-and-updating.md`](</Users/fran/.codex/skills/.system/plugin-creator/references/installing-and-updating.md>). Expect hook-definition changes to need renewed trust. Do not use `--dangerously-bypass-hook-trust` in the product or demo.

## Hook contract

Codex invokes each command hook with one JSON object on stdin. Common fields include `session_id`, `cwd`, `hook_event_name`, `model`, and `transcript_path`; turn-scoped events add `turn_id`, and most relevant events include `permission_mode`. The transcript format is explicitly unstable. [Common hook input fields](https://learn.chatgpt.com/docs/hooks#common-input-fields)

Register the bridge for these events:

| Event | Bridge purpose | Output |
| --- | --- | --- |
| `SessionStart` | Associate session/worktree; request initial context. Sources include `startup`, `resume`, `clear`, and `compact`. | `additionalContext` when available, otherwise `{}`. |
| `UserPromptSubmit` | Mark turn active; request refreshed context without forwarding `prompt`. | `additionalContext` only when needed, otherwise `{}`. |
| `PermissionRequest` | Record that user attention is requested. Do not approve or deny. | `{}`. |
| `PostToolUse` | Record resumed/continuing activity. Do not forward `tool_input` or `tool_response`. | `{}`. |
| `SubagentStart` / `SubagentStop` | Maintain a deduplicated active-subagent set/count. | `{}`. |
| `Stop` | Record turn completion. | `{}`. |

Codex launches matching command hooks concurrently, and multiple hook sources accumulate rather than override each other. The bridge therefore must be idempotent and cannot assume it is the only hook. `PermissionRequest` fires only when Codex is about to ask for approval; it is not proof that the user later approved. `PostToolUse` means a supported tool completed, while `Stop` means the turn ended, not that the requested work succeeded. [Hook runtime behavior](https://learn.chatgpt.com/docs/hooks), [permission event semantics](https://learn.chatgpt.com/docs/hooks#permissionrequest), [stop semantics](https://learn.chatgpt.com/docs/hooks#stop)

### Strict ingress allowlist

The runner may send only this normalized payload:

```ts
interface CodexHookObservation {
  version: 1;
  event:
    | "SessionStart"
    | "UserPromptSubmit"
    | "PermissionRequest"
    | "PostToolUse"
    | "SubagentStart"
    | "SubagentStop"
    | "Stop";
  sessionId: string;
  turnId?: string;
  cwd: string;
  permissionMode?: string;
  source?: "startup" | "resume" | "clear" | "compact";
  agentId?: string;
  agentType?: string;
}
```

The server supplies `observedAt`; it does not trust a client timestamp. Reject unknown keys and bound every string. Explicitly discard `prompt`, `transcript_path`, `model`, `tool_name`, `tool_input`, `tool_response`, `last_assistant_message`, and `agent_transcript_path`. Do not open a transcript. The runner should cap stdin (for example 1 MiB); exceeding the cap is a successful no-op.

The follow-up [hook-to-task identity research](codex-hook-task-identity-research.md) validates a deliberately narrow join for the demo: accept public activity only when a discovered top-level task has `id === session_id` and the same exact canonical `cwd`. Subagent hooks retain the root `session_id` and expose their concrete child thread as `agent_id`, so preserve those identities separately and aggregate child activity under the discovered root. Keep unmatched observations internal, request a coalesced discovery refresh, and never synthesize a public placeholder task.

### Context response

For `SessionStart` and `UserPromptSubmit`, the runner constructs the documented event-specific JSON rather than printing a server-provided blob directly:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<bounded Workgrove context>"
  }
}
```

Both events add this as developer context. For all observational-only outcomes, print `{}` and exit `0`; this is also safe for `Stop` and `SubagentStop`, whose successful output must be JSON. Never return `decision`, `continue: false`, `stopReason`, `systemMessage`, permission decisions, or exit code `2`. [Session-start context](https://learn.chatgpt.com/docs/hooks#sessionstart), [prompt-submit context](https://learn.chatgpt.com/docs/hooks#userpromptsubmit), [common output behavior](https://learn.chatgpt.com/docs/hooks#common-output-fields)

Keep context well below the host's roughly 2,500-token per-message limit (target 4–8 KiB). Oversized output can be written to a temporary file, which is another reason never to return secrets. [Large hook output](https://learn.chatgpt.com/docs/hooks#large-hook-output)

## Dedicated local capability

Workgrove currently binds HTTP to `127.0.0.1` and creates a random browser mutation token in `src/server/server.ts`. That token is deliberately obtainable from unauthenticated `GET /api/session`; its protection also depends on same-origin checks for browser mutations. It is a CSRF/session mechanism, not a secret suitable for a non-browser plugin.

Add a separate hook capability:

```json
{
  "version": 1,
  "endpoint": "http://127.0.0.1:3999/api/codex/hooks",
  "token": "<32 random bytes, base64url>",
  "pid": 12345,
  "processStartMarker": "Sat Jul 18 12:00:00 2026",
  "generatedAt": "2026-07-18T12:00:01.000Z"
}
```

Security requirements:

- Create `~/.workgrove/codex` as a dedicated private directory owned by the current user with mode `0700`; do not assume the existing `~/.workgrove` directory or its other state files are private.
- Create a same-directory temporary file with mode `0600`, write and fsync if practical, then atomically rename it to `capability.json`. Avoid following symlinks.
- Generate a separate 256-bit token on every server start. Include the daemon PID and the same process-start marker Workgrove uses to detect PID reuse. Remove the capability on clean shutdown only if it still describes this process/token; stale records are rejected when their PID/start marker no longer matches and fail authentication after a daemon restart.
- Accept only loopback connections, `POST`, `application/json`, a small body, and `Authorization: Bearer <hook token>` (or a dedicated `x-workgrove-hook-token`). Reject requests carrying a browser `Origin` header.
- The route can record observations and return safe context only. It must not expose general Workgrove commands, logs, environment values, or the browser token.
- Same-user processes can read a `0600` capability; the OS user account is the local trust boundary. The design prevents arbitrary web pages and other OS users from invoking the bridge, not malware already running as the user.

A Unix-domain socket could remove the localhost web surface later, but it adds a second server lifecycle and platform seam. The dedicated tokenized loopback route fits the existing daemon for the demo and is sufficiently isolated when the capability and route are scoped as above.

## Server-side worktree validation

The runner is intentionally repository-agnostic. It sends `cwd`; the server must:

1. Canonicalize the path and resolve the containing Git worktree root through `WorkspaceController` or an internal controller module.
2. Require exactly `<that-worktree-root>/.workgrove.json`.
3. Parse it with the existing Workgrove schema and resolve its app groups/ports. A merely existing but invalid file does not opt in.
4. Build context from that exact worktree's config and current runtime inspection, not from another branch's/main worktree's config.
5. Return a successful no-op for paths outside Git, missing worktrees, missing/invalid config, or a worktree that is no longer known.

This distinction matters because the current general workspace inspection selects one config and projects it across discovered worktrees. Branch-local hook opt-in requires a purpose-built controller method that validates the event worktree itself.

Safe context may include canonical path, branch/detached SHA, app-group names, Friendly and backing endpoint availability, readiness/route state, health/listener state, and Workgrove process ownership. Exclude command argv, environment values, logs, tokens, and content from other Codex tasks. Serialize in a fixed, bounded format; treat repository-controlled labels and branch names as data, not instructions.

## Timing and failure behavior

The official default command-hook timeout is 600 seconds, which is unsuitable here; asynchronous command hooks are currently skipped. Set every bridge handler to `timeout: 2`. [Hook timeout and handler support](https://learn.chatgpt.com/docs/hooks#config-shape)

Inside the runner:

- Spend at most 500–750 ms connecting/posting to Workgrove.
- Use no retry in the foreground hook. A later lifecycle event is the retry.
- On capability read/parse failure, connection refusal, timeout, non-2xx, schema mismatch, or invalid context response, emit `{}` and exit `0`.
- Never write diagnostics to stdout. Optional diagnostics go to a small rotating file under `PLUGIN_DATA` or Workgrove's control directory and must not contain hook input.

The server should deduplicate observations and expire live status because hooks can be disabled, missed, or interrupted. Transport success is not a reason to keep stale `working` or `waiting-for-approval` state indefinitely.

## Implementation handoff

1. Add a controller-owned `observeCodexHook(cwd, observation)`/context seam with exact worktree validation.
2. Add capability lifecycle and the authenticated loopback endpoint without changing `/api/session` or reusing its token.
3. Scaffold `workgrove` with default `hooks/hooks.json`; omit manifest `hooks` until the local validator is corrected.
4. Implement a bounded, allowlisting, fail-open runner and event-specific context wrappers.
5. Test absent daemon, bad token, stale capability, non-loopback/origin request, oversized input, invalid/missing `.workgrove.json`, symlinked/subdirectory cwd, each event shape, and unchanged/changed context.
6. Validate the plugin, install/reinstall the cached copy, explicitly trust hooks, and verify events in a new desktop Codex task.

## Primary sources

- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: Build plugins](https://learn.chatgpt.com/docs/build-plugins)
- [OpenAI: Plugins](https://learn.chatgpt.com/docs/plugins)
- [Local plugin-creator manifest reference](</Users/fran/.codex/skills/.system/plugin-creator/references/plugin-json-spec.md>)
- [Local plugin-creator update flow](</Users/fran/.codex/skills/.system/plugin-creator/references/installing-and-updating.md>)
- [Local plugin validator](</Users/fran/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py>)
