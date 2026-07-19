# Portless runtime proof for Workgrove's multi-app model

_Research snapshot: 18 July 2026._

> **Release-boundary correction:** the broad upstream proof in this document used
> commit `e0c2af5`, whose package still reported version `0.15.4`, but the npm
> `portless@0.15.4` artifact pinned by Workgrove identifies commit `74c98682`.
> The npm release supports the verified plain-HTTP and HTTP/1.1 WebSocket path,
> but lacks the RFC 8441 implementation used by browser HMR over HTTPS/HTTP2.
> See [Portless routing and recovery research](./portless-routing-recovery-research.md)
> for the release-to-main source comparison.

## Decision

**Current Portless is sufficient for Workgrove's first Friendly URL integration without a fork**, provided Workgrove:

1. runs a pinned Portless build under Node 24 in an exclusive `PORTLESS_STATE_DIR`;
2. continues to own app-group commands, process supervision, backing-port allocation, and the complete named environment;
3. uses exact static aliases only after verifying the expected listener;
4. observes route activation before declaring an app ready;
5. observes route deactivation before stopping the app or releasing its backing port; and
6. retains stable hostname intent in Workgrove state rather than treating a Portless alias as a stopped-app reservation.

The proof found no missing plain-HTTP, HTTP/1.1 WebSocket/HMR, exact-name, concurrency, or proxy-restart capability that requires an immediate Portless fork. HTTPS browser HMR requires the next upstream RFC 8441 commit (or an equivalent local patch), so the production packaging decision must not treat the npm `0.15.4` artifact as sufficient for that mode.

Two production questions remain open: how Workgrove packages the required Node 24 runtime, and whether it should later add a synchronous structured route API. Those are not blockers to the first functional integration.

## Evidence boundaries and environment

Runtime tests used a fresh clone of the official [`vercel-labs/portless`](https://github.com/vercel-labs/portless) repository at commit [`e0c2af5734fcdc2f6c6992423a023d8ec0c68e26`](https://github.com/vercel-labs/portless/tree/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26), package version `0.15.4`. That package declares Node `>=24` ([package manifest](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/package.json#L1-L22)).

The verified runs used:

- macOS arm64;
- Node `24.18.0`, downloaded from the official Node.js `latest-v24.x` distribution and checksum-verified, for the broad upstream and protocol suite;
- Node `24.14` for the focused Workgrove-style multi-app, alias-lifecycle, restart, HTTPS, and Bun comparison proof;
- pnpm `11.1.3`, matching Portless's package manager declaration;
- Bun `1.3.11` for a separate compatibility check;
- an isolated temporary clone, home directory, Portless state directory, CA, backing servers, and Git worktrees;
- HTTP proxy port `41355` and HTTPS proxy port `41356` rather than privileged ports;
- no global package installation, no writes to `~/.portless`, and no successful global CA trust change.

Claims labelled **runtime verified** below were observed in these runs. Claims labelled **source verified** were inspected in the pinned official source but were not dependent on a runtime observation.

### Upstream baseline: 723 tests passed

**Runtime verified.** Before interpreting integration behavior, the pinned Portless checkout's upstream test suite was run under its supported Node runtime. All **723 tests passed**. This establishes that the tested build was not a locally broken or partially built checkout; the Workgrove-specific observations below are additions to the upstream baseline, not substitutes for it.

Representative proxy startup and alias commands were:

```sh
PORTLESS_STATE_DIR=<temporary-state> \
  node packages/portless/dist/cli.js proxy start \
  --port 41355 --no-tls --foreground

PORTLESS_STATE_DIR=<temporary-state> \
PORTLESS_PORT=41355 \
PORTLESS_HTTPS=0 \
  node packages/portless/dist/cli.js alias web.wt-a 42101
```

The prior schema/source investigation remains useful background: [portless-schema-compatibility-research.md](./portless-schema-compatibility-research.md). This report supersedes its conclusion that owner-aware aliases block the initial integration: an exclusive Workgrove state directory removes foreign alias ownership from the first architecture.

## Runtime results

### Multi-app groups and concurrent worktrees: passed with aliases

**Runtime verified.** Two representative Workgrove-style group commands ran concurrently. Each group launched a Web and API listener and received its complete named environment before launch:

```text
worktree A: WEB_PORT=42101 API_PORT=42102 WEB_URL=... API_URL=...
worktree B: WEB_PORT=42201 API_PORT=42202 WEB_URL=... API_URL=...
```

Four aliases routed independently:

```text
web.wt-a.localhost -> 42101
api.wt-a.localhost -> 42102
web.wt-b.localhost -> 42201
api.wt-b.localhost -> 42202
```

HTTP responses from all four endpoints identified the correct app and worktree. Both children in each group saw the same complete `WEB_PORT`, `API_PORT`, `WEB_URL`, `API_URL`, and custom sentinel values. As expected in alias mode, Portless did not inject `PORT` or `PORTLESS_URL` into these Workgrove-owned processes.

This is the right integration seam: Workgrove resolves the whole group environment and starts the group, while Portless exposes each verified HTTP listener separately.

### Wrapping one multi-app group: failed by model, not by proxy

**Runtime verified.** Wrapping the same group once with:

```sh
portless wrapped-group node group.mjs
```

gave the group one generic `PORT=4933` and one `PORTLESS_URL`, while its declared Web and API listeners were on `42401` and `42402`. Both children inherited the misleading generic values, and `wrapped-group.localhost` returned `502` because nothing listened on `4933`. The direct Web and API listeners still responded and retained the complete named environment.

This matches Portless's documented single-child environment contract: it injects one `PORT`, one `HOST`, and one `PORTLESS_URL` ([README environment variables](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#L418-L442), [launch implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L1452-L1527)). Portless's monorepo mode starts one command per discovered package rather than representing one Workgrove command with several declared endpoints ([multi-app implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L3433-L3613)).

**Conclusion:** never wrap an app group once. No Portless change is needed; use per-app aliases after Workgrove starts the group.

### Exact names work; inferred worktree names collide

**Runtime verified.** Exact named mode used the supplied name unchanged:

```sh
portless exact-name node print-env.mjs
```

produced `exact-name.localhost`. Static aliases likewise used the supplied name.

By contrast, `portless run --name shared` produced:

| Checkout | Observed hostname |
|---|---|
| main worktree | `shared.localhost` |
| detached worktree | `shared.localhost` |
| `feature/auth` linked worktree | `auth.shared.localhost` |
| `fix/auth` linked worktree | `auth.shared.localhost` |

Running the two `auth` worktrees concurrently caused the second launch to fail with an already-registered route conflict. The behavior follows the official inference code: linked worktrees use the last branch segment, while main/master and detached worktrees receive no prefix ([worktree inference](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/auto.ts#L154-L268)). `run --name` still applies that prefix, while direct named mode does not ([run mode](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L4029-L4076), [exact named mode](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L4079-L4122)).

**Conclusion:** Workgrove must generate collision-safe stable names and use exact aliases. Portless discovery must not define endpoint identity.

### HTTP, WebSockets, Vite HMR, and HTTPS: passed on the post-release proof commit

**Runtime verified.** HTTP requests were routed correctly and preserved the external `Host`; backends observed the expected `X-Forwarded-Host` and `X-Forwarded-Proto` values.

A real WebSocket upgrade traversed the proxy and returned `101 Switching Protocols` with the backend's expected identifier and valid `Sec-WebSocket-Accept` value.

A minimal Vite `8.1.4` dev server was then placed behind an alias. The HTML loaded through the Friendly URL, and a `vite-hmr` WebSocket connected through Portless and received Vite's `{"type":"connected"}` message. The same HMR flow passed over `wss://` when Node was given the isolated CA through `NODE_EXTRA_CA_CERTS`. This HTTPS result applies to `e0c2af5`; npm `0.15.4` predates its RFC 8441 implementation.

For HTTPS, Portless generated its CA and certificate inside the isolated state directory. Ordinary `curl` failed with certificate error `60`, as expected without trust. `curl --cacert <isolated-ca.pem>` succeeded and the backend observed `X-Forwarded-Proto: https`. Portless implements HTTP routing, HTTP/1 WebSocket upgrades, TLS/HTTP2, and HTTP/2 extended CONNECT in the pinned proxy source ([HTTP path](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts#L121-L306), [WebSocket and TLS paths](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts#L309-L708)).

**Conclusion:** proxy functionality is not a reason to fork Portless. Trusted system CA installation and privileged-port packaging still need their own production proof.

### Process ownership, cleanup, and proxy restart: passed with a clear boundary

**Runtime verified.** A normal wrapped route recorded the Portless wrapper PID; the backend ran as its child. Sending `SIGINT` to the wrapper stopped the child, removed the route, and changed the Friendly URL to Portless's unregistered-route `404`.

Workgrove-style direct group processes were independent of the proxy. Stopping and restarting the Portless proxy temporarily removed Friendly URL availability but did not stop the groups. Restarting the proxy with the same isolated state restored both static aliases and a still-live wrapped route.

This matches the source lifecycle: wrapper routes use a nonzero PID and cleanup is PID-conditional, while static aliases use PID `0` and persist until explicitly removed ([route loading](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L168-L205), [conditional removal](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L353-L371)).

**Conclusion:** Workgrove process ownership and Portless routing remain cleanly separable.

### Alias activation and deactivation are asynchronous

**Runtime verified.** `portless alias activation-delay 42301` returned success before the running proxy had loaded the new route. Requests sampled every 50 ms were:

```text
404, 404, 200, 200, ...
```

Likewise, `portless alias --remove vite-proof` returned success before the proxy stopped serving its cached route:

```text
200, 200, 404, 404, ...
```

The proxy watches/polls its routes file rather than synchronously acknowledging a loaded revision ([proxy startup and route watching](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L560-L668)).

**Required Workgrove behavior:** after adding a route, probe until the expected endpoint answers before showing the link as Ready. After removing a route, observe the unregistered state before releasing the backing port. A future synchronous revision/acknowledgement API would improve this, but polling is sufficient for the first integration.

### A persistent alias to a stopped app is unsafe

**Runtime verified.** After stopping the expected Web process while leaving its alias registered, the Friendly URL returned `502`. A foreign process then bound the old backing port; the same Friendly URL immediately served the foreign process successfully.

This is why Workgrove must persist hostname **intent**, not a live Portless route. The route should exist only between verified listener readiness and observed route deactivation.

### Alias ownership is weak, but exclusive state changes the priority

**Runtime verified.** Re-registering an existing alias name to a different port without `--force` succeeded. After the proxy's reload delay, the hostname routed to the new backend. All static aliases have PID `0`, and `addRoute` treats equal PIDs as the same owner, so alias-to-alias replacement has no foreign-owner check ([alias registration](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2258-L2321), [conflict logic](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L216-L250)). A live non-alias route did reject an alias takeover without `--force`, and the original backend remained live.

This would be unsafe in shared `~/.portless` state. It is **not an initial blocker** under the chosen product model because Workgrove owns the Portless dependency and can give it an exclusive state directory. Workgrove must serialize its own route operations and never use `--force`. Owner IDs and conditional mutations become worthwhile if state is ever shared with standalone Portless or multiple independent Workgrove engines.

### There is no structured CLI status contract

**Runtime verified.** `portless list --json` ignored the unsupported flag and printed the same human-formatted table as `portless list`. `portless get` formats a URL but does not prove a route is registered. The corresponding official implementations are human-output `list` and calculation-only `get` ([list](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L976-L1000), [get](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2197-L2255)).

For the first integration, Workgrove can treat its own endpoint registry as desired state and verify the observable HTTP route. Because Portless is pinned and its state is exclusive, Workgrove can also use its exported `RouteStore` or a small sidecar rather than parsing terminal prose; Portless exports `RouteStore` and `createProxyServer`, although it does not document a stable programmatic API ([exports](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/index.ts#L1-L5)).

### The built CLI is not currently a Bun runtime replacement

**Runtime verified.** The built `0.15.4` CLI could start a no-TLS proxy and add/list aliases under Bun `1.3.11`. However, proxying a static alias to a verified live IPv4 loopback target consistently returned `502`/`ECONNREFUSED`; direct requests to the target succeeded. The same build and equivalent target worked under Node 24.

The relevant proxy path uses Node's `net.connect` Happy Eyeballs behavior with a custom loopback lookup ([loopback connection](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/utils.ts#L55-L91)), and Portless officially requires Node 24 rather than Bun.

**Conclusion:** Workgrove must not execute current Portless inside its Bun runtime and assume compatibility. The first integration should run a pinned Node 24 sidecar. Making Portless fully Bun-compatible is an optional fork investigation, not necessary to prove or build Friendly URLs.

## Concrete gaps and their priority

| Gap | Blocks first integration? | Required response |
|---|---:|---|
| Portless requires Node 24 and failed the proxy test under Bun | **Yes, if no Node sidecar is supplied** | Package or locate a pinned Node 24 runtime; separately investigate Bun support only if avoiding Node materially improves distribution. |
| Alias add/remove returns before the proxy applies the change | No | Poll observable activation/deactivation; do not release the backing port until deactivation is observed. |
| No documented structured route/proxy/CA status API | No | Start with Workgrove desired state plus probes and an isolated pinned engine; consider a thin JSON sidecar or later Portless change. |
| PID-zero aliases have no owner identity | No with exclusive state; yes if state becomes shared | Use an exclusive Workgrove `PORTLESS_STATE_DIR`, serialize operations, and never use `--force`. Add owner-aware conditional mutation only if sharing becomes a requirement. |
| System CA trust and privileged 443 service were not exercised | No for functional integration; required before production packaging | Run a separate installation/recovery proof without weakening TLS validation. |

## Contract for the first implementation

The runtime proof supports this narrow design:

```text
WorkspaceController
  1. chooses backing ports and renders the full app-group environment
  2. starts and supervises the app-group command
  3. verifies each declared listener belongs to the expected process tree
  4. asks a Portless adapter to register exact aliases in private state
  5. waits until each Friendly URL reaches the expected app
  6. exposes links and route state in the dashboard

Stop path
  1. remove exact aliases
  2. wait until Portless no longer serves them
  3. stop the app group
  4. release backing ports
```

Workgrove's persistent mapping owns stable endpoint identity and hostname intent. Portless owns only live HTTP ingress. A stopped app has a known future Friendly URL but no active route and no clickable Open link, matching the chosen product behavior.

## Fork decision

Do **not** fork Portless before the first end-to-end Workgrove integration. The present version already proved the essential routing behavior. Use a local pinned copy and exclusive state while the product is still local-only.

Open a Portless fork only when one of these concrete triggers occurs:

- packaging Node 24 is materially worse than fixing verified Bun incompatibility;
- polling activation/deactivation proves unreliable enough to require a route revision acknowledgement;
- the dashboard needs proxy/CA diagnostics that cannot be obtained safely through the pinned sidecar; or
- Workgrove must share a Portless namespace with independently managed tools, requiring owner-aware conditional route mutations.

Until one of those tests fails, Portless changes would add maintenance without improving the first user journey.
