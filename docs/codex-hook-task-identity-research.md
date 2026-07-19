# Codex hook-to-task identity correlation

_Research snapshot: 18 July 2026. Official documentation and the `openai/codex` implementation were checked at commit `56395bddaf26eb2829387ca6a417bf9128e5b239`. Local protocol checks used the ChatGPT desktop-bundled `codex-cli 0.144.2` on macOS. No task identifiers, titles, prompts, transcripts, Git values, or repository-sensitive paths were printed or retained._

## Decision

For Workgrove's demo inventory, a lifecycle hook's `session_id` can be joined directly to a discovered top-level Codex task's `id`, provided the discovered task also has the exact canonical worktree `cwd`.

That rule is deliberately narrower than “hook session IDs are task IDs”:

- `session_id` identifies a **session tree** shared by a root thread and its descendants.
- `Thread.id` identifies one **concrete thread**.
- For a top-level root thread, Codex initializes the session-tree ID from that thread ID, so the strings are equal.
- For a subagent thread, `session_id` remains the root's ID. Subagent-capable hook payloads additionally expose `agent_id`, which is the concrete subagent thread ID.
- `turn_id` identifies one turn and must never be used as task identity.

Workgrove's first discovery adapter intentionally uses the app-server's default interactive source filter, which excludes subagent threads. Therefore every task in the demo inventory is a top-level root and the narrow `session_id -> task.id` join is appropriate. Unmatched hook observations must remain internal, trigger a coalesced discovery refresh, and expire; they must not create provisional public tasks.

## Identity model

```text
session tree
  session_id = root Thread.id
  |
  +-- root thread
  |     concrete id = session_id
  |     turn 1 id != turn 2 id
  |
  +-- subagent thread
        concrete id = agent_id
        hook session_id = root Thread.id
        parentThreadId = root Thread.id
```

The official hooks reference calls `session_id` the current Codex session ID and explicitly states that subagent hooks use the parent session ID. It separately documents `turn_id` on turn-scoped hooks. [OpenAI Hooks: common input fields](https://learn.chatgpt.com/docs/hooks#common-input-fields)

The implementation makes the distinction explicit:

- `Session::thread_id()` returns the concrete thread identity, while `Session::session_id()` returns the identity shared by the root and all descendants. [`Session` identity accessors](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/session/session.rs#L458-L467)
- One `AgentControl` is shared across the root's subagent tree, and it owns that shared session ID. [`AgentControl` session-tree scope](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/agent/control.rs#L88-L134)
- The app-server `Thread` type exposes separate `id`, `sessionId`, `forkedFromId`, and `parentThreadId` fields. [`Thread` protocol fields](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L167-L181)
- Hook construction always serializes `sess.session_id()`. For a thread-spawn subagent, it also serializes `agent_id` from `sess.thread_id()`. [`SessionStart`/`SubagentStart` construction](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/hook_runtime.rs#L108-L138), [`turn-scoped hook construction`](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/hook_runtime.rs#L163-L180), [`subagent identity projection`](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/hook_runtime.rs#L782-L800)

## Lifecycle cases

| Case | What remains stable | What changes | Join implication | Confidence |
| --- | --- | --- | --- | --- |
| New top-level task | `session_id == Thread.id` | Turns and tool calls | Join `session_id` to discovered `id`, then verify exact canonical `cwd`. | High |
| Multiple turns in one task | `session_id` and `Thread.id` | `turn_id` per turn | Keep status at task level; use `turn_id` only for ordering/deduplication within that task. | High |
| Resumed top-level task | Original `session_id` and `Thread.id` | New turns; `SessionStart.source` is `resume` | The same join survives resume. | High |
| Top-level `thread/fork` | The fork gets its own new `Thread.id` and matching root `session_id` | It is a distinct task with `forkedFromId` | Join the fork's hooks to the fork task, not the source task. | High from implementation; not locally exercised |
| Thread-spawn subagent | Root `session_id`; concrete child `agent_id` | Child turns and tools | Aggregate child activity on the root via `session_id`; use `agent_id` only if child threads are explicitly inventoried later. | High |
| Internal/synthetic subagent | No complete public lifecycle guarantee | Implementation-dependent | Do not infer status from absence or synthesize a task. | High that coverage is incomplete; low about future behavior |

For new roots, cleared roots, and root forks, the core creates a new `ThreadId` and derives the root `SessionId` from it. For resume, it restores the persisted session ID and reuses the persisted conversation/thread ID. A non-root agent instead inherits the parent agent-control session ID. [`Session` create/resume identity selection](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/session/session.rs#L535-L574)

The hook lifecycle itself is not a complete execution trace. Current docs say most hooks run at turn scope, `SessionStart` at thread scope, and specialized tool paths may bypass ordinary tool hooks. This is why Workgrove should expire status and treat hooks as best-effort observations rather than authoritative history. [OpenAI Hooks: runtime behavior](https://learn.chatgpt.com/docs/hooks), [OpenAI Hooks: tool coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage)

## Recommended Workgrove join contract

Normalize identities without copying content-bearing hook fields:

```ts
interface CodexHookIdentity {
  sessionTreeId: string; // hook session_id
  concreteAgentThreadId?: string; // hook agent_id, subagents only
  turnId?: string; // ordering/deduplication only
  cwd: string;
}
```

Apply this algorithm:

1. Validate bounded, non-empty identifier strings and canonicalize `cwd` through the controller-owned worktree seam.
2. Require a valid root `.workgrove.json` for that exact worktree before recording or returning context.
3. Find a discovered **top-level** task where `task.id === sessionTreeId` and `task.cwd === canonicalCwd`.
4. If exactly one match exists, apply the observation to that task. This is the demo's only public join.
5. If `concreteAgentThreadId` is present, maintain any subagent count/set under the matched root task. Do not replace the root task ID with the child ID. If subagent tasks become part of inventory later, join the child only when a discovered row explicitly has `id === concreteAgentThreadId` and the expected parent/session relationship.
6. Use `turnId` plus event type/tool-use ID where available to deduplicate or order observations, never to locate a task.
7. If no root task matches, retain a minimal unmatched observation internally, request one coalesced discovery refresh for the exact `cwd`, retry the same join, then expire it. Expose neither a placeholder task nor guessed status.

The exact-`cwd` check is a guard against malformed or misrouted hook traffic; it is not a substitute identity key. Many tasks can legitimately share a worktree.

### Fail-closed rules

- Never correlate by title, prompt, preview, transcript path/content, Git branch, or recency.
- Never treat `turn_id`, tool-use IDs, or approval request IDs as task IDs.
- Never treat a subagent's shared `session_id` as the child thread ID.
- Never publish a hook-only task before persisted discovery returns it.
- On conflicting identity fields, malformed IDs, an invalid/missing worktree config, or a `cwd` mismatch, record nothing public and return no context.
- If hooks stop arriving, expire `working`/`waiting-for-approval` according to the activity policy; absence is not proof of completion.

## App-server projection caveat

The app-server protocol now models `Thread.sessionId` separately from `Thread.id`, but current cold stored-thread projection can fall back to setting `sessionId = id`. Loaded-thread responses overwrite that fallback with the runtime session ID. [`thread_from_stored_thread` fallback](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/app-server/src/request_processors/thread_processor.rs#L4789-L4844), [`loaded-thread correction`](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/app-server/src/request_processors/thread_processor.rs#L2436-L2445)

This does not affect the demo because default `thread/list` inventory contains top-level interactive roots, for which `sessionId` and `id` are intentionally equal. It does mean a future subagent-aware integration must not infer family relationships from a cold list row's `sessionId` alone; it should use concrete `id`, `parentThreadId`, source metadata, and verified runtime/session evidence.

## Sanitized local validation

Two metadata-only probes used the bundled `codex-cli 0.144.2` with experimental APIs disabled:

- A fully paginated, non-archived default `thread/list` returned 347 records. Every record was top-level (`parentThreadId` absent) and every record satisfied `id === sessionId`.
- An ephemeral top-level `thread/start` returned a root thread satisfying `id === sessionId` and did not persist a task.

Probe output contained only the CLI version, counts, and booleans. The installed version's generated non-experimental TypeScript schema also exposes both `Thread.id` and `Thread.sessionId`. OpenAI documents generated app-server schemas as version-specific to the running CLI. [OpenAI App Server: message schema](https://learn.chatgpt.com/docs/app-server#message-schema)

These probes support the root-only demo join on this host. They do not expand the contract to subagents or guarantee future versions; the adapter should still validate behavior and fail closed.

## Implementation consequence

The hook bridge ticket may safely implement the demo with this invariant:

> A public live status update is accepted only when a discovered top-level task has the same ID as the hook `session_id` and the same exact canonical worktree directory.

Retain `sessionTreeId` and optional `concreteAgentThreadId` as distinct internal fields so later subagent support does not require a schema reinterpretation. The public `CodexTaskSnapshot` needs no extra identity field for the demo because it exposes only top-level tasks; a future child-task projection should add explicit parent/session-tree relationships instead of overloading `id`.

## Primary sources

- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Codex source: session identity](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/session/session.rs)
- [OpenAI Codex source: shared agent control](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/agent/control.rs)
- [OpenAI Codex source: hook runtime](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/core/src/hook_runtime.rs)
- [OpenAI Codex source: app-server thread protocol](https://github.com/openai/codex/blob/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs)
- [OpenAI Codex source: generated hook schemas](https://github.com/openai/codex/tree/56395bddaf26eb2829387ca6a417bf9128e5b239/codex-rs/hooks/schema/generated)
