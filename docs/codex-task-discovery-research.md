# Persisted Codex task discovery for Workgrove

_Research snapshot: 18 July 2026. Official documentation was checked on that date. Local protocol evidence was collected from the ChatGPT desktop-bundled `codex-cli 0.144.2` on macOS. No authentication files, credentials, transcripts, prompt values, task-name values, preview values, or raw task payloads were printed or inspected._

## Conclusion

Workgrove can discover every persisted, user-visible Codex task whose captured working directory exactly matches a managed worktree by running one private, long-lived `codex app-server --stdio` child and calling the non-experimental `thread/list` method.

The implementation should:

1. Resolve every managed worktree to its canonical absolute path.
2. Initialize one stdio app-server connection with experimental APIs disabled.
3. Call `thread/list` with the canonical path array, `useStateDbOnly: true`, `sortKey: "updated_at"`, and `sortDirection: "desc"`.
4. Omit `sourceKinds` so Codex applies its documented interactive-source default (`cli` and `vscode`). This includes the locally observed desktop tasks while excluding subagent threads.
5. Fully paginate non-archived tasks. The same protocol supports `archived: true`, but archived inventory is deliberately deferred beyond the demo.
6. Decode only the small metadata subset Workgrove needs and ignore unknown fields.
7. Treat discovery as optional and cached. Missing, incompatible, slow, or exited Codex processes must not affect ordinary Workgrove inspection or controls.

This is a sound demo integration, but it needs a compatibility boundary: the official command reference still labels `codex app-server` **Experimental** and says it may change without notice, even though `thread/list` itself appears in the generated non-experimental protocol surface. The adapter should detect required behavior rather than hard-code a CLI version allowlist ([App Server documentation](https://learn.chatgpt.com/docs/app-server), [developer command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-app-server)).

## Supported protocol contract

### Transport and initialization

The default app-server transport is newline-delimited JSON over stdio; `--stdio` is an alias for `--listen stdio://`. A client must send exactly one `initialize` request and then an `initialized` notification before using other methods. The official docs say pre-initialization requests fail with `Not initialized` and a repeated initialization fails with `Already initialized` ([protocol](https://learn.chatgpt.com/docs/app-server#protocol), [initialization](https://learn.chatgpt.com/docs/app-server#initialization)).

Use this stable-capability handshake:

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"workgrove","title":"Workgrove","version":"<workgrove-version>"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
{"method":"initialized"}
```

`clientInfo.name` should remain stable and identify Workgrove. Do not pass `--experimental` or opt into `experimentalApi`; basic `thread/list`, its `cwd` filter, archived filter, pagination, and sorting are all present in the non-experimental schema. Generated TypeScript and JSON schemas match the exact installed Codex version and are useful for compatibility investigation, though Workgrove should not need to generate them at runtime ([message schema](https://learn.chatgpt.com/docs/app-server#message-schema)).

### Exact discovery request

The installed non-experimental schema defines `cwd` as one string or an array of strings and says only threads whose session working directory exactly matches one of those paths are returned. Relative inputs resolve from the app-server process directory, so Workgrove should never send them. The schema also documents:

- `archived: false` or omitted returns only non-archived threads;
- `archived: true` returns only archived threads;
- `cursor` is opaque;
- `limit` is optional;
- the default sort is newest `created_at` first;
- supported sort keys are `created_at`, `updated_at`, and `recency_at`;
- `sourceKinds` omitted or empty selects interactive `cli` and `vscode` threads;
- `useStateDbOnly: true` prevents rollout JSONL scanning and metadata repair.

The same contract is documented in the official `thread/list` guide ([list threads with pagination and filters](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters)). The recommended first page is:

```json
{
  "method": "thread/list",
  "id": 2,
  "params": {
    "cwd": ["/canonical/worktree/a", "/canonical/worktree/b"],
    "archived": false,
    "useStateDbOnly": true,
    "sortKey": "updated_at",
    "sortDirection": "desc",
    "limit": 100,
    "cursor": null
  }
}
```

Pass each returned `nextCursor` unchanged to the next call until it is `null`. For the demo, stop there: Task inventory contains only non-archived tasks. The validated `archived: true` query remains useful protocol evidence for the deferred [archived-task support](https://github.com/FranciscoMoretti/workgrove/issues/32), but is not part of the first adapter contract.

An exact worktree-root match deliberately does **not** associate a task captured in a descendant directory. That is the agreed demo boundary. The locally tested server normalized a syntactic trailing slash before matching, but this should not replace Workgrove's own canonicalization.

### Response subset

The generated `Thread` schema is much larger than Workgrove needs and includes sensitive or unstable fields such as `preview` and the on-disk `path`. Do not retain or expose those fields. Decode this subset and ignore all other properties:

```ts
interface DiscoveredCodexTask {
  id: string;
  name: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  gitInfo: {
    sha: string | null;
    branch: string | null;
    originUrl: string | null;
  } | null;
}
```

Use `name` as the user-facing title. If it is absent, render an inert fallback such as “Untitled Codex task”; do not fall back to `preview`, because that normally derives from user content. Treat timestamps as Unix seconds. The generated schema says thread IDs are UUIDv7, but Workgrove only needs to validate them as bounded non-empty strings for forward compatibility. `gitInfo` is useful display metadata, not the association key; `cwd` remains authoritative.

Do not use these fields for the first integration:

- `status`: it describes the runtime state in the app-server process that returned it, not a reliable cross-process view of desktop activity;
- `path`: explicitly marked unstable and points to on-disk task data;
- `preview`: derived from user content;
- `turns`: documented to be empty for `thread/list` and unnecessary for discovery;
- `source` or `threadSource`: useful for diagnostics, but not stable identity or association keys.

The separate lifecycle-hook integration should own live task activity. Official docs distinguish persisted listing from threads loaded into one server's memory and publish status changes for loaded threads ([track thread status](https://learn.chatgpt.com/docs/app-server#track-thread-status-changes), [list loaded threads](https://learn.chatgpt.com/docs/app-server#list-loaded-threads)).

## Sanitized local validation

### Method

The local executable resolved from `PATH` to:

```text
/Applications/ChatGPT.app/Contents/Resources/codex
codex-cli 0.144.2
```

The following commands generated the installed version's non-experimental schemas in a temporary directory:

```sh
codex app-server generate-ts --out <temporary-directory>
codex app-server generate-json-schema --out <temporary-directory>
```

The generated schema confirmed the request fields, enum values, response fields, `thread/list` method name, and initialization shapes described above. It was generated **without** `--experimental`.

Sanitized Bun probes then launched `codex app-server --stdio`, performed the stable handshake, and issued only `thread/list` requests for the canonical Workgrove checkout path. Probe output was restricted to counts, booleans, field names, source/status categories, timing, and pagination shape. It never printed IDs, names, previews, paths, Git values, task payloads, stderr, or transcript data. `useStateDbOnly` was always `true`; no probe requested JSONL scan-and-repair behavior.

### Results

The observations below demonstrate behavior for this machine and version; they are not guarantees for future Codex versions:

| Probe | Sanitized result |
|---|---|
| Initialization | Succeeded with `experimentalApi: false`; response identified Unix/macOS. |
| Current exact-cwd tasks | 20 interactive threads across 20 one-item pages. Every returned `cwd` matched the requested canonical path. |
| Archived exact-cwd tasks | 1 interactive thread in one page. Its `cwd` matched. |
| Pagination | Every non-final page had `nextCursor`; every non-empty page had `backwardsCursor`; the final page had no `nextCursor`. |
| Ordering | Concatenated pages were descending by `updatedAt`. |
| Summary contents | `turns` was empty for every result; timestamps were integer seconds; every result had a non-empty `name`, `preview`, and `gitInfo`, though no values were inspected. |
| Default sources | Omitting `sourceKinds` returned 20 current and 1 archived threads, all reported as `vscode`. |
| Explicit all sources | The same current query with every schema enum returned 69 threads: 20 `vscode` and 49 `subAgent`. The default set was a subset. |
| Runtime status | Every separately listed thread reported `notLoaded`, reinforcing that this process is unsuitable for desktop live status. |
| Forward compatibility | Responses contained additional fields not present in the generated `Thread` TypeScript type even though experimental APIs were disabled. A strict whole-object decoder would therefore be brittle. |
| Cold connection timing | One observed initialization took 44 ms. A 20-row, state-DB-only list took 4 ms. These are descriptive, not service-level guarantees. |
| Process lifecycle | The app-server had no direct child process after the list request and exited with status 0 when stdin closed. |

The source comparison is important: current ChatGPT desktop local tasks are observed as `vscode`, and Codex's documented default includes them. Explicitly requesting every source kind would pollute Workgrove's task list with internal subagent threads. Omit `sourceKinds` for the demo.

## Executable resolution

OpenAI documents how to run the CLI and app-server, but does not promise a fixed filesystem path for a desktop-bundled executable. The current machine exposes the ChatGPT bundle path above. Treat path selection as a Workgrove host policy:

1. Use an explicit app-level override if Workgrove adds one.
2. Resolve `codex` directly from the server process `PATH` without invoking a shell.
3. On macOS, check known signed app-bundle resource candidates, including the currently observed ChatGPT resource path in `/Applications` and the user's `Applications` directory.
4. Validate a candidate with a short `codex --version` subprocess; never interpolate it into a shell command.
5. If none works, report discovery as unavailable.

Do not set a separate `CODEX_HOME`: discovery must use the ordinary per-user Codex state seen by the desktop application. Do not inspect credential or authentication files to validate an executable.

## Adapter lifecycle, caching, and failure behavior

### Process model

Use one lazily started, long-lived child for the Workgrove server, not one child per worktree or poll. Initialize it once, assign monotonically increasing request IDs, correlate responses by ID, tolerate unrelated notifications, and serialize or safely multiplex pages. The adapter should own all Codex process behavior behind `WorkspaceController`.

On Workgrove shutdown, close app-server stdin, wait briefly for normal exit, then terminate the exact child PID if required. On unexpected EOF or exit, fail outstanding requests, retain the last good snapshot as stale, and permit one controlled restart on a later refresh. Never loop rapid restarts.

Do not persist raw stdout or stderr. A bounded diagnostic containing only executable version, failure category, exit code, and sanitized protocol error code is sufficient.

### Cache policy

A practical initial policy is:

- 30-second successful discovery TTL;
- stale-while-revalidate so UI rendering never waits for Codex;
- immediate refresh when the Codex section is explicitly opened or the application regains focus, coalesced with any in-flight refresh;
- 5-second negative cache after an unavailable/error result to prevent request storms;
- one cache entry keyed by the sorted canonical worktree-path set, containing the fully paginated non-archived result.

The separate live-activity hook channel can refresh presentation more frequently without making persisted discovery poll at hook cadence.

### Timeouts and guards

Initial conservative budgets:

- 1 second for executable version validation;
- 3 seconds for initialize;
- 3 seconds per `thread/list` page;
- 10 seconds for one complete non-archived refresh;
- detect repeated cursors and abort rather than loop forever;
- cap response line size and decoded string lengths;
- reject malformed required subset fields without crashing the server.

These budgets are intentionally much larger than the local observation. They are implementation defaults to tune with real repositories, not protocol promises.

### Compatibility and privacy failures

Return a structured availability state such as `available`, `missing`, `timed-out`, `incompatible`, or `failed`, plus a last-success timestamp. Keep the previous valid snapshot when possible and mark it stale. Ordinary `WorkspaceController.inspect()`, Git operations, app-group controls, logs, and previews must remain usable regardless of Codex availability.

Use behavioral detection:

- initialize with stable capabilities;
- call `thread/list` with the required safe parameters;
- validate only the response subset;
- ignore unknown fields;
- accept unknown CLI versions when behavior is compatible.

If an older server rejects `useStateDbOnly`, **do not retry without it**. The documented fallback scans rollout JSONL files to repair metadata, which violates this discovery pass's privacy boundary. Mark that executable incompatible instead. Likewise, never fall back to reading task files, the state database, transcripts, or credential state directly.

## Concrete implementation recommendation

Build a `CodexTaskDiscoveryAdapter` behind `WorkspaceController` with these responsibilities:

```text
resolve executable
  -> start and initialize one stdio child
  -> list interactive current tasks for all canonical worktree roots
  -> paginate to completion
  -> decode safe metadata subset
  -> group by exact returned cwd
  -> publish cached optional projection
```

Keep the adapter independent from lifecycle-hook activity. The resulting demo projection should expose **all non-archived** tasks grouped under each worktree and should not select a primary task. UI hierarchy can be decided later without losing active-task data. Archived-task UX and projection changes are tracked separately.

Test the adapter with a fake JSONL child covering initialization, multiple pages, multiple `cwd` values, unknown response fields, missing names, repeated cursors, malformed rows, timeouts, EOF, nonzero exit, and absence of the executable. Add an opt-in local integration test that runs only when a compatible `codex` binary is available and asserts sanitized structure—not any user's task content.

With that boundary, persisted association is sufficiently validated to implement. The open compatibility risk is contained within one optional adapter, while canonical `cwd`, stable task ID, and direct `codex://threads/<id>` navigation provide the demo's useful core.
