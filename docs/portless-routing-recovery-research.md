# Portless routing and recovery research

_Research snapshot: 18 July 2026. Workgrove's installed `portless@0.15.4` corresponds to official source commit [`74c98682edf6fc629b6aa4b059508cbd8fb2d29b`](https://github.com/vercel-labs/portless/tree/74c98682edf6fc629b6aa4b059508cbd8fb2d29b), as recorded by the release's npm `gitHead`._

## Answer

The pinned Portless release is sufficient for Workgrove's current plain-HTTP Friendly URLs, including ordinary HTTP and HTTP/1.1 WebSockets. It is **not yet sufficient evidence for HTTPS Vite HMR**: `0.15.4` serves pages over HTTP/2 but does not implement browser WebSockets over HTTP/2 extended CONNECT. The sole upstream commit after the release, [`e0c2af5`](https://github.com/vercel-labs/portless/commit/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26), adds RFC 8441 specifically to repair Next.js/Vite HMR under HTTPS ([release-to-main diff](https://github.com/vercel-labs/portless/compare/74c98682edf6fc629b6aa4b059508cbd8fb2d29b...e0c2af5734fcdc2f6c6992423a023d8ec0c68e26)).

The larger recovery risk is Portless's control plane:

- aliases have PID `0`, not a Workgrove owner identity;
- alias mutations return before the proxy reloads them;
- aliases survive proxy and Workgrove crashes until explicitly removed;
- PID, route, and CLI output do not prove the expected application owns a listener;
- certificate trust and per-host certificate recovery have cases `doctor` cannot prove.

The safe boundary remains: Workgrove owns stable identity, processes, listener ownership, readiness, and desired Friendly URL mappings. Portless owns only live hostname-to-loopback-port ingress in a Workgrove-exclusive state directory. Workgrove must never invoke `--force` or `portless prune` automatically.

## Evidence boundary

The installed artifact and a fresh npm `0.15.4` tarball were byte-identical for the compiled CLI. Its checksums were:

```text
090b6dbac77e43dbb6beb06eaa07248fc21fd30448bb72a7ed53e0eb3e5a00ca  dist/cli.js
3dc9443a90a893f6a4a00c2a6610ef95199da4310210677060e02bbe436c2c59  dist/index.js
c9c6fb2d1daf5fa5af049a5e9fa905bc459a5dc1dbf2e50d66237772f6464cd2  dist/chunk-JSJUKQRJ.js
```

The release is pre-1.0, warns that its state format can change, exposes one package root, and requires Node 24 ([README warning](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/README.md#L10-L24), [package manifest](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/package.json#L1-L26), [root exports](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/index.ts#L1-L5)). The root exports proxy and route primitives, but not certificate, daemon, service, or `doctor` orchestration.

Findings below distinguish direct **source facts**, derived **Workgrove implications**, and **runtime proofs still needed**.

## HTTP, WebSockets, and Vite HMR

### Source facts

Portless selects routes from `Host` or HTTP/2 `:authority`, preserves the external host, adds `X-Forwarded-*`, and dials IPv4 or IPv6 loopback. Unregistered names return a Portless-marked `404`; registered routes with an unavailable backend return a Portless-marked `502` ([HTTP path](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L156-L297)). Every normal response carries `X-Portless: 1`, and the official liveness check uses that header to distinguish Portless from a foreign listener ([header](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L156-L159), [liveness probe](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli-utils.ts#L729-L760)).

HTTP/1.1 WebSocket upgrades are forwarded to the selected route and the backend's `101`, `Sec-WebSocket-Accept`, subprotocol, and extensions are relayed ([upgrade path](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L300-L409)). Under TLS, `0.15.4` creates an HTTP/2 server with HTTP/1.1 fallback and accepts WebSocket upgrades only on HTTP/1.1 connections. It does not advertise or handle RFC 8441 extended CONNECT ([TLS server](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L411-L499)). The post-release commit adds that missing browser HTTP/2 bridge and improved failed-handshake `502` responses ([upstream fix](https://github.com/vercel-labs/portless/commit/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26)).

The release does tune HTTP/2 reset handling for navigation/HMR churn, but its Vite end-to-end test only loads the initial page; it does not open a browser HMR socket or prove edit delivery ([reset behavior](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L411-L435), [Vite E2E](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/tests/e2e/src/vite.test.ts#L11-L21)).

Portless detects repeated proxying through `X-Portless-Hops` and returns `508 Loop Detected`. Its Vite guidance requires `changeOrigin: true` and `ws: true` when a Vite frontend proxies another Friendly URL ([loop detection](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/proxy.ts#L62-L75), [Vite guidance](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/README.md#L471-L503)).

When Portless wraps Vite it injects `--port`, `--strictPort`, `--host`, `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, and, under TLS, `NODE_EXTRA_CA_CERTS`. Workgrove's alias integration receives none of these; `alias` only writes hostname-to-port state ([framework flags](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli-utils.ts#L1018-L1121), [wrapped environment](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L1467-L1510), [alias path](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2258-L2322)).

### Workgrove implications

- Current HTTP on port 1355 does not require a fork. HTTP/1.1 HMR/WebSockets are on the supported path.
- Before enabling HTTPS, Workgrove must upgrade/cherry-pick `e0c2af5` or prove browsers consistently negotiate HTTP/1.1 for HMR. Adopting the upstream fix is the safer route.
- Proxy identity must require `X-Portless: 1`, not merely a live `proxy.pid`. App identity still requires listener ownership plus an app-specific/end-to-end check.
- Workgrove owns Vite's port and bind setup in alias mode. HTTPS inter-app Node clients also need the Portless CA path explicitly mapped without overwriting repository configuration.
- Repository-to-repository proxy behavior such as `changeOrigin` remains checked-in app configuration, not a Workgrove naming convention.

### Runtime proof needed

- Real browser Vite HMR through a Workgrove multi-level hostname: initial connection, source edit, update delivery, disconnect, and reconnect over HTTP.
- The same flow over HTTPS/HTTP2 after adopting the RFC 8441 commit.
- A plain WebSocket through backend crash/restart, proxy restart, and Stop; verify failed handshakes are diagnosable.
- Vite-to-API proxying with and without `changeOrigin`, so the dashboard can distinguish deliberate `508` from app failure.

## HTTPS and certificate recovery

### Source facts

HTTPS defaults to port 443. Portless generates a local CA and leaf certificates with OpenSSL and attempts OS trust installation. Trust failure is only a warning: the proxy still starts and directs the user to `portless trust` ([startup](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L3219-L3284)). On macOS a non-root trust operation targets the login keychain and can wait up to 120 seconds for GUI authorization; root targets the system keychain ([macOS trust](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L862-L950)). Dashboard-triggered auto-start on privileged ports also fails early without a TTY ([non-interactive startup](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L1040-L1103)).

The CA is valid for ten years, leaf certificates for one year, with regeneration seven days before expiry. Missing, unreadable, expired, or weak CA material generates a new CA; invalid server material generates a new server certificate ([validity](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L16-L29), [regeneration](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L405-L450)).

Each subdomain receives an exact-SAN certificate lazily through SNI and caches it under `host-certs`. Cache reuse verifies readability, expiry, and signature strength, but not that the leaf was signed by the **current** CA ([generation](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L625-L744), [reuse](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L747-L858)).

Successful trust writes the CA fingerprint to `ca.trusted`. When that marker matches, `isCATrusted` returns `true` without querying the OS trust store ([marker](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L76-L119), [fast path](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/certs.ts#L452-L480)). `doctor` checks OpenSSL, CA presence, and that same trust predicate; it does not perform verified TLS handshakes for lazy hostname certificates ([doctor checks](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2670-L2709)).

### Inferred risks and Workgrove implications

1. If CA identity is regenerated while an unexpired `host-certs` leaf remains, SNI may reuse a leaf signed by the old CA. This likely produces an invalid chain and needs runtime confirmation.
2. If a user removes the CA from Keychain Access but leaves `ca.trusted`, Portless may falsely report it trusted. This also needs controlled proof.
3. Proxy listening, CA trusted, and exact-host TLS handshake are separate dashboard states.
4. Trust installation is an explicit machine-level setup/repair action, not something Start should hide inside repository launch.
5. Until the trust and recovery matrix passes, explicit HTTP/no-TLS remains the safe engine default.

### Runtime proof needed

- Accept, deny, cancel, and time out the macOS trust prompt; then repair with `portless trust`.
- Remove only the OS trust entry while retaining `ca.trusted`; compare `doctor` with a verified browser/TLS handshake.
- Generate a hostname leaf, replace only the CA identity, restart, and retry that hostname; verify whether deleting `host-certs` repairs it.
- Independently corrupt or remove CA, server, and host certificate/key files; also test missing OpenSSL and unwritable certificate state.
- Verify `portless clean` removes exactly its CA and supports retry after trust-store removal failure.

## Route persistence, restart, and conflicts

### Source facts

Routes live in locked `routes.json` records containing `hostname`, `port`, and `pid`. Dead nonzero-PID routes are stale; PID `0` routes are retained. Static aliases use PID `0`, so they survive proxy restarts until explicitly removed ([store](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/routes.ts#L18-L90), [loading](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/routes.ts#L168-L205), [alias registration](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2312-L2321)).

The proxy loads routes at startup and watches the file with a 100 ms debounce, falling back to three-second polling. Alias commands update the file and return without proxy acknowledgement ([watch constants](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L133-L140), [reload](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L560-L655)). Graceful proxy cleanup removes runtime markers but leaves `routes.json`, so Workgrove should continue passing explicit state, port, TLS, and TLD settings on every invocation ([cleanup](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L784-L815)).

Route writes directly replace `routes.json`; invalid JSON/read errors become an empty list, with no journal or backup ([I/O](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/routes.ts#L174-L214)). The proxy's intended keep-old-cache catch does not help parse errors because `loadRoutes` swallows them and returns empty ([reload behavior](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L610-L637)).

A different live nonzero PID causes conflict unless `force` is set; `force` sends it `SIGTERM`. The same PID replaces its own route. Since every alias is PID `0`, an alias can silently replace another alias without `force` ([conflict](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/routes.ts#L216-L250)). `--force` has no PID-zero guard: a process-owned route attempting to force-take an alias can reach `process.kill(0, "SIGTERM")`, which targets the caller's process group; never call it. Alias removal is hostname-based with no Workgrove owner token ([alias removal](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2281-L2297), [conditional store removal](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/routes.ts#L353-L371)).

`portless prune` removes stale non-alias routes and then kills whatever process currently listens on each recorded backing port; it does not prove that listener is the old wrapper's child ([prune](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2110-L2186)).

### Workgrove implications

- Exclusive state prevents standalone Portless collisions, but not collisions among Workgrove aliases. Serialize operations and compare exact `{hostname, port}` before mutation.
- Never use `--force` or `prune`. A recycled port could terminate an unrelated process.
- Poll observable activation/deactivation; CLI success alone must not change Ready/Open state or release a backing port.
- On restart, rebuild routes from Workgrove identity only after re-proving listener ownership. Missing/corrupt Portless state is not evidence that the app stopped.
- A fork could add atomic writes, route revisions, and owner-token conditional mutation, but current single-controller exclusive HTTP operation can remain conservative without it.

### Runtime proof needed

- Restart the proxy with `SIGTERM` and `SIGKILL` while apps survive; verify aliases and URLs recover without rerunning repository commands.
- Truncate, corrupt, remove, make read-only, and lock-contend `routes.json`; define repair behavior.
- Race alias mutation with proxy restart and two controller instances; group publication must remain all-or-none.
- Test same/different-port aliases and a live non-alias conflict; verify Workgrove preserves foreign mappings.
- Let a foreign listener rebind a stopped alias's old port; Workgrove must disable the alias before it becomes an Open link.

## CLI availability, diagnostics, and re-adoption

### Source facts

`list` is human-formatted. `get` calculates a URL but does not prove route registration ([list](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L976-L1000), [get](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2197-L2255)). There is no `proxy status`; `service status` is not a structured proxy contract.

`doctor` checks Node, state writability, proxy/PID consistency, OpenSSL, CA trust, route records, TCP listeners, DNS, and LAN support. It emits prose; failures exit `1`, warnings exit `0`; aliases count as live and backing checks prove only that some TCP listener exists ([scope](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2502-L2524), [proxy/PID](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2619-L2668), [routes](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2711-L2768), [exit](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli.ts#L2808-L2821)).

With explicit `PORTLESS_STATE_DIR`, discovery accepts either a Portless response or **any listener** on the recorded port, although lower-level `isProxyRunning` correctly requires `X-Portless: 1` ([discovery](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli-utils.ts#L550-L595), [liveness](https://github.com/vercel-labs/portless/blob/74c98682edf6fc629b6aa4b059508cbd8fb2d29b/packages/portless/src/cli-utils.ts#L729-L760)). `alias` does not start or verify the proxy; it discovers state and writes routes.

### Workgrove implications

Portless cannot re-adopt a Workgrove app. Alias PID `0` contains no application PID, launch fingerprint, process tree, or expected listener proof. Workgrove startup reconciliation must:

1. verify pinned Node and CLI availability plus state readability/writability;
2. require `X-Portless: 1` on the configured proxy port and treat another listener as conflict;
3. start Portless with every setting explicit when absent;
4. re-prove Workgrove process identity and listener ownership independently;
5. reapply and end-to-end verify routes only for safely adopted listeners;
6. disable exact old aliases and quarantine backing ports for missing, foreign, or ambiguous listeners; and
7. keep apps/direct endpoints alive in Degraded state if Portless later disappears.

`doctor` is useful human evidence but should not be parsed as an API. Workgrove needs its own structured capability report. Direct `RouteStore` use is acceptable only behind the pinned adapter and exclusive state boundary; it is not a version-stable contract.

### Runtime proof needed

- Remove/corrupt pinned Node, CLI, and package files; Start must fail before repository code with a precise capability error.
- Test unwritable state, route-lock timeout, missing OpenSSL, and daemon-log startup failure.
- Put a foreign server on the proxy port with missing, stale, and recycled PID files; it must never be reported Active.
- Kill Workgrove while process-owned and configured-Stop/Docker-style apps survive; restart, re-adopt, recover routes/logs, then Stop.
- Repeat with a foreign process on a previously recorded backing port; refuse adoption without killing it.

## Integrated Workgrove runtime verification

`bun run prove:routing-recovery` exercises Workgrove's real controller, local-state store, Portless adapter, Vite server, and process supervisor in an isolated temporary control directory. It does not touch the user's live Workgrove or Portless state. Together with `bun run prove:multi-app-routing`, it produced this matrix:

| Scenario | Result | Evidence and consequence |
| --- | --- | --- |
| Duplicate repository basenames | Product gap | Allocation order changes the random collision suffix. Friendly URL labels must be derived deterministically from endpoint identity ([#37](https://github.com/FranciscoMoretti/workgrove/issues/37)). |
| Branch rename | Pass | The same repository/worktree/app identity retained the same Friendly URL. |
| Worktree path move | Known limitation | Path remains part of identity; durable identity across moves is already tracked in [#34](https://github.com/FranciscoMoretti/workgrove/issues/34). |
| One ready and one unready app in a group | Product gap | Group state became `partially-running`, but the ready app's route remained inactive and had no link because publication waits for every readiness probe ([#38](https://github.com/FranciscoMoretti/workgrove/issues/38)). |
| Foreign listener on a reserved Backing port | Pass | Workgrove refused to launch or adopt it, reported the conflict, and quarantined the allocation until the listener disappeared. |
| Foreign Portless route | Pass | The multi-app proof preserved the foreign mapping and refused to steal its hostname. |
| Vite page and HTTP/1.1 HMR WebSocket | Pass | The page loaded through a multi-level Friendly URL and a `vite-hmr` WebSocket received Vite's `connected` message. Source-edit delivery remains browser-level dashboard QA, not part of this command proof. |
| Portless proxy crash while app survives | Pass | The repository PID and Backing endpoint survived; Retry restored the same Friendly URL without re-running the app command. |
| App process crash and manual Start | Pass | Readiness became unready and explicit Start recovered the same stable URL. No automatic repository command ran. |
| Route truth after app crash | Product gap | Readiness was unready while `routeState` remained `active`, because observation proved only the persistent alias and proxy PID, not the expected backend ([#40](https://github.com/FranciscoMoretti/workgrove/issues/40)). |
| Controller restart while app survives | Pass | A verified managed process was re-adopted without re-running its start command. |
| Foreign process on Portless proxy port | Product gap | Repository code started before route activation discovered the conflict. Portless capability and ownership must be preflighted first ([#39](https://github.com/FranciscoMoretti/workgrove/issues/39)). |
| Invalid Portless route state | Product gap | Workspace inspection threw instead of preserving app/process state and exposing degraded routing ([#39](https://github.com/FranciscoMoretti/workgrove/issues/39)). |
| HTTPS and certificate recovery | Deliberate limitation | Workgrove currently forces HTTP/no-TLS. Packaging, the post-release RFC 8441 fix, trust, and certificate recovery remain in [#30](https://github.com/FranciscoMoretti/workgrove/issues/30). |

The command currently reports six passes, five product gaps, and two deliberate limitations. These are classification counts, not test-suite assertions: the proof exits successfully only when each observed behavior still matches its recorded category, making contract drift visible while the follow-up work is incomplete.

## Graduated work

- [#37](https://github.com/FranciscoMoretti/workgrove/issues/37): deterministic collision suffixes for stable Friendly URLs.
- [#38](https://github.com/FranciscoMoretti/workgrove/issues/38): publish ready apps while an app group is only partially ready.
- [#39](https://github.com/FranciscoMoretti/workgrove/issues/39): structured Portless preflight and degraded-state handling.
- [#40](https://github.com/FranciscoMoretti/workgrove/issues/40): reconcile crashed processes, stale aliases, and Backing endpoint ownership.
- [#30](https://github.com/FranciscoMoretti/workgrove/issues/30): choose and prove the production Portless/HTTPS packaging boundary.
- [#34](https://github.com/FranciscoMoretti/workgrove/issues/34): preserve identity across repository/worktree path moves.

No Portless fork change is necessary for Workgrove's current exclusive-state, plain-HTTP path. The Workgrove-side lifecycle gaps above should be resolved before dashboard implementation. HTTPS adoption must use the RFC 8441 change in `e0c2af5` or a later release and separately prove macOS trust and certificate recovery; that decision belongs to #30.

## Graduation criteria

Each runtime scenario should end as a current pass, a focused Workgrove fix, or a reproducible Portless-fork ticket. Likely fork candidates are the released HTTP/2 WebSocket gap, stale SNI certificates after CA replacement, stale trust-marker reporting, atomic route persistence, structured diagnostics, revision acknowledgement, and owner-token conditional aliases.

Do not graduate speculative work: a fork ticket needs a failing command, expected/actual behavior, affected state files/processes, and the smallest upstream seam that repairs it.
