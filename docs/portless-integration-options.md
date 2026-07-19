# Portless as part of the Workgrove engine

_Research snapshot: 18 July 2026. Portless was inspected at version 0.15.4 and commit [`e0c2af5`](https://github.com/vercel-labs/portless/tree/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26). Claims about Portless come from its official documentation, package metadata, source, changelog, and license. Claims about Workgrove come from this repository._

## Executive recommendation

Portless can materially improve Workgrove, but it should initially be an **optional HTTP routing provider**, not Workgrove's allocator or process supervisor.

The best first integration is:

1. Workgrove continues to discover worktrees, assign slots, compute backing ports, approve repository commands, start and stop processes, attribute listeners, and retain logs.
2. A routing-provider seam optionally registers selected HTTP apps as persistent Portless aliases.
3. Workgrove displays both the direct endpoint and a friendly URL.
4. The friendly hostname is derived by Workgrove from repository, worktree, group, and app identity. It does not rely on Portless's branch-name heuristic.
5. Portless installation, proxy startup, CA trust, and service installation are explicit host setup actions. Repository commands cannot trigger them.

This gives Workgrove the largest user benefit—stable HTTPS names, HTTP/2, WebSocket/HMR support, and potentially LAN/Tailscale/ngrok access—without surrendering its differentiating ownership model. It also makes a URL survive a Workgrove slot switch: Workgrove repoints the alias from the old backing port to the new one while the browser-facing URL stays unchanged.

The main obstacle is not proxying. It is **safe shared route ownership**. Portless's public CLI has no JSON route output or owner namespace. Static aliases are recorded with PID `0`, persist until removed, and cannot express “this route belongs to Workgrove worktree X/app Y.” Before treating the adapter as fully supported, Workgrove should ask Portless upstream for a machine-readable, owner-scoped route API.

## The two products' natural boundary

### What Workgrove already owns well

Workgrove's checked-in v2 contract declares independently slotted app groups. Each app's backing port is `basePort + slot * stride`; command environment can refer to every group's ports and URLs ([schema](../src/config/workgrove-schema.ts), [resolution](../src/config/workgrove-config.ts)). The controller discovers all Git worktrees, computes expected endpoints, inspects TCP listeners, and marks each listener `owned`, `foreign`, or absent ([controller](../src/controller/workspace-controller.ts), [port inspection](../src/runtime/ports.ts)).

For process-controlled groups, Workgrove launches a detached process group, persists PID/start-marker records, captures logs, verifies cwd containment, and escalates from `SIGTERM` to `SIGKILL` ([supervisor](../src/runtime/process-supervisor.ts)). It fingerprints the complete repository lifecycle/configuration contract and requires reapproval when it changes ([repository trust](../src/config/repository-trust.ts)).

Those are the core control-plane semantics. Portless does not improve them enough to justify replacing them.

### What Portless adds

Portless turns a local backing port into a named route such as `https://myapp.localhost`. Its proxy supports HTTPS, HTTP/2 with HTTP/1.1 fallback, ordinary WebSocket upgrades, and WebSocket-over-HTTP/2 extended CONNECT; the proxy only binds loopback unless LAN mode is explicitly enabled ([overview and HTTPS](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#http2--https), [proxy implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts)). It generates and trusts a local CA, can run as an OS startup service, synchronizes hosts entries where required, and optionally exposes apps over LAN, Tailscale, Funnel, or ngrok ([service and LAN](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#start-at-os-startup), [sharing](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#tailscale-sharing)).

These are valuable presentation and ingress capabilities. Building all of them inside Workgrove would add certificate, DNS, proxy-protocol, HMR, and platform-service maintenance that is outside Workgrove's current differentiator.

## Portless facts that constrain the decision

### Ports and routes

- `portless run` normally chooses a random free port from 4000–4999, sets `PORT` and usually `HOST`, and injects framework-specific flags when a framework ignores `PORT` ([configuration](https://portless.sh/configuration), [free-port implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L686-L731)). Its own implementation documents an unavoidable check-to-bind race.
- `--app-port` / `PORTLESS_APP_PORT` lets a caller retain a fixed backing port. This is the bridge that could preserve Workgrove's slot model when wrapping a process ([commands](https://portless.sh/commands)).
- `portless alias <name> <port>` registers an already-managed service without launching it. Alias routes use PID `0`, so they persist and are excluded from stale-process cleanup ([alias command](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2258-L2322), [route loading](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L168-L205)).
- Route state is a shared per-user JSON store under `~/.portless`, protected by a filesystem lock. A route contains hostname, backing port, and owner PID, plus optional sharing metadata ([state files](https://portless.sh/configuration#state-files), [route schema/store](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L18-L90)).
- A live conflicting route raises an error unless `--force` is used. `--force` sends `SIGTERM` to the existing route owner's PID before replacing it ([route conflict code](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L216-L250)). Workgrove must never use `--force` automatically.
- `portless list` is human-formatted output, not a documented JSON API ([list implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L976-L1000)).

### Process lifecycle

For a managed app, Portless registers the route to the Portless CLI's PID, spawns the actual command in a new Unix process group, forwards `SIGINT`/`SIGTERM`, and removes only routes still owned by its PID during cleanup ([run path](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L1257-L1528), [spawn and signal handling](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L915-L1007)). `portless prune` exists because a killed/crashed wrapper can leave a child dev server behind ([official commands](https://portless.sh/commands#prune-orphans)).

Wrapping a Workgrove start command therefore nests two supervisors and two detached process-group models. Graceful shutdown should usually work, but a hard failure can leave the inner child outside Workgrove's original process group. Workgrove can still find and stop it when the backing port remains a known Workgrove port and the listener cwd is inside the worktree, but the composition is more complex than using aliases.

### Worktree naming

`portless run` detects linked worktrees and prefixes the route with a sanitized branch label ([worktree docs](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#git-worktrees)). The source uses only the final branch path segment (`feature/auth` becomes `auth`), skips main/master, and returns no prefix for detached HEAD ([implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/auto.ts#L172-L206)).

That heuristic is pleasant for direct CLI use but insufficient as Workgrove's route identity: `feature/auth` and `fix/auth` can collide, detached worktrees get no prefix, and two repositories can infer the same project/app name. Workgrove already has canonical repository/worktree context and should generate globally collision-resistant names itself.

### TLS, elevation, and host security

HTTPS defaults to port 443. First use generates a CA, modifies the system trust store, and may elevate with `sudo`; service installation writes launchd/systemd/Task Scheduler configuration and may run the proxy as root/SYSTEM ([README](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#run-your-app), [service docs](https://portless.sh/commands#os-startup-service)). Portless intentionally fails rather than prompting in a non-interactive environment when interaction is required.

Therefore Workgrove's daemon should not silently bootstrap HTTPS, modify the trust store, install a service, enable LAN mode, or enable a public tunnel. These are **host capability approvals**, separate from Workgrove's repository-command trust. A repository's `.workgrove.json` must never be able to request them on its own.

When LAN mode is off, current Portless binds only `127.0.0.1` and `::1`; LAN mode explicitly binds all interfaces ([0.15.4 changelog](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/CHANGELOG.md#0154)). Workgrove should treat LAN, Tailscale, Funnel, and ngrok as progressively stronger exposure levels with separate confirmation and visible status.

### Public package API and compatibility

The published `portless` package exports `createProxyServer`, `createHttpRedirectServer`, `RouteStore`, route types, URL/host utilities, and hosts-file helpers. Certificate generation/trust, proxy daemon/service management, free-port discovery, worktree inference, and the CLI orchestration functions are not exported from the package root ([public index](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/index.ts), [package exports](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/package.json)).

Portless 0.15.4 requires Node.js 24 or newer, while Workgrove currently requires Bun 1.3+ and does not require Node ([Portless package](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/package.json#L20-L26), [Workgrove package](../package.json)). Portless also explicitly describes itself as pre-1.0 and warns that its state format may change between releases ([installation warning](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#L10-L24)). A direct runtime dependency would therefore broaden Workgrove's engine requirements and stability surface.

### License

Portless and Workgrove are both Apache-2.0. Importing the package is license-compatible. Vendoring or distributing modified Portless code is permitted, but requires preserving the license and applicable notices, marking modified files, and avoiding implied rights to Vercel trademarks ([Portless license](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/LICENSE)).

## Integration routes

### Decision matrix

| Route | User value | Architectural fit | Main risk | Recommendation |
|---|---:|---:|---|---|
| 1. Optional external command wrapper | Medium | Medium | Nested supervision; one wrapper route does not fit multi-app groups | Useful experiment, not default |
| 2. External Portless proxy + aliases; Workgrove keeps ports/processes | High | High | Global alias ownership and missing machine API | **Recommended first route** |
| 3. Delegate ports and processes to Portless | Medium | Low | Removes Workgrove's precomputed endpoint/ownership contract | Do not use as core engine |
| 4. Import Portless package APIs | High potential | Medium | Partial API, Node 24, pre-1.0 coupling | Consider after upstream API work |
| 5. Vendor or fork Portless | High potential | Low initially | Permanent proxy/TLS maintenance burden | Last resort |
| 6. No integration; adopt concepts | Low-to-medium | High | Rebuilding proxy features or offering no friendly URLs | Keep as fallback/control |

## Route 1: wrap a Workgrove start command with `portless run`

Conceptually:

```text
Workgrove supervisor
  -> portless run --name <workgrove-name> --app-port <workgrove-port> <trusted argv...>
       -> repository dev process
```

### Benefits

- Fastest end-to-end proof of named HTTPS routes.
- `--app-port` preserves Workgrove's stable slot and listener-inspection model.
- Portless automatically owns route registration/removal and passes `PORTLESS_URL`, CA configuration, framework flags, and proxy behavior to the child.
- Workgrove still captures the combined stdout/stderr stream.

### Problems

- It nests supervisors and Unix process groups. Stop/error semantics become the composition of Workgrove and Portless rather than one authority.
- A Workgrove group can declare several apps at several known ports, while one `portless run` invocation owns one primary name/port. Extra apps still need aliases or separate wrappers.
- Portless modifies the child environment and may inject command-line flags. That is useful for a standalone CLI but surprising when Workgrove already provides an explicit repository environment.
- Auto-start/trust prompts cannot safely occur in Workgrove's non-interactive daemon.
- Using Portless's zero-argument or script-inference modes would weaken Workgrove's trust guarantee: Workgrove might fingerprint only `portless`, while Portless later resolves a changed `package.json` command. If this route is used, the complete underlying argv, Portless mode, fixed port, generated name, and relevant Portless config/version must be included in the effective fingerprint.

### Verdict

Use only for a spike or an opt-in single-HTTP-app mode. Never make the repository rewrite its own scripts to call Portless, and never allow Portless script inference behind a previously approved Workgrove command.

## Route 2: use Portless as the proxy; keep Workgrove as controller

Workgrove starts the repository command exactly as it does now. Separately, a host adapter registers selected expected ports:

```text
Browser -> stable Portless hostname -> Workgrove-assigned backing port
                                      -> Workgrove-owned repository process
```

This maps cleanly to Portless's static alias feature, which is explicitly intended for services not managed by Portless ([alias docs](https://portless.sh/commands#alias-static-routes)).

### Benefits

- No nested process supervisor. Workgrove remains the only process owner.
- Workgrove's ports, environment templates, collision checks, listener ownership, health, stop semantics, and logs remain intact.
- Every HTTP app in a multi-app group can receive its own hostname.
- The browser-facing URL can remain stable when the user switches slots; only the alias target changes.
- Portless's proxy, TLS, HTTP/2, HMR/WebSockets, diagnostics, and optional sharing are reused instead of reimplemented.
- Portless can be absent without degrading core Workgrove behavior: direct `http://localhost:<port>` URLs still work.

### Problems

- Aliases are persistent global state with PID `0`, not scoped to Workgrove.
- The CLI has no structured list/reconcile interface and no `ownerId`, compare-and-swap revision, or “remove only if still owned by X” operation.
- The current alias path does not provide enough ownership evidence for Workgrove to safely adopt or delete an arbitrary existing route. Collision-resistant names greatly reduce the probability but do not create a strong guarantee.
- A persistent alias can intentionally outlive a stopped app. It produces Portless's 502 page until the expected listener returns. Workgrove should show this as “route ready, app stopped,” not confuse it with process health.
- Portless only proxies HTTP and WebSockets. TCP-only apps such as Postgres, Redis, SMTP, or arbitrary protocol listeners must remain direct endpoints.

### Safe initial scope

- Make routing explicitly opt-in per app and initially support only `protocol: "http"`.
- Require users to install and provision Portless separately, then let Workgrove detect capability. Do not auto-install it.
- Resolve and remember an explicitly trusted host executable path; do not pick a repository-local `node_modules/.bin/portless`, because that makes an untrusted repository package a host-control dependency.
- Never pass `--force`.
- Use a collision-resistant Workgrove namespace and a Workgrove-owned local registry mapping route name to repository/worktree/group/app/backing port.
- Keep aliases persistent across ordinary Start/Stop. Reconcile them only when enabling routing, switching slots, renaming/removing endpoints, deleting a worktree, or disabling the provider.
- On any ambiguity, leave the existing route untouched and show a conflict. Never infer permission to kill a route owner.

### Verdict

This is the recommended product direction and the right first adapter. It should begin as experimental until route reconciliation is machine-readable and owner-scoped.

## Route 3: delegate both ports and processes to Portless

In this model Workgrove would ask Portless to choose a random backing port and launch each process, then discover routes afterward.

### Benefits

- Removes the need for users to teach every framework to consume a Workgrove-generated port.
- Dynamic free ports avoid most raw port conflicts.
- Portless already handles framework flags, proxy route cleanup, and monorepo discovery.

### Costs

- Workgrove can no longer precompute the repository environment before Start. Existing `{...port}` templates, slot previews, conflict checks, and detached infrastructure contracts become conditional or disappear.
- The URL becomes stable but the raw endpoint is dynamic. Native clients, databases, mobile tools, integration tests, and non-HTTP protocols often still require a real port.
- Listener ownership must be reconstructed from Portless's shared route store and process trees after launch. Portless records its wrapper PID as route owner, not the backend listener's PID/worktree cwd.
- Multi-app discovery and lifecycle would be split between `.workgrove.json`, `portless.json`, package scripts, and Portless's workspace inference.
- Workgrove would inherit Portless's free-port TOCTOU race and pre-1.0 state format.

### Verdict

Do not replace Workgrove's engine with this model. A future endpoint type could deliberately choose `allocation: "dynamic-http"` for simple web apps, but it should coexist with—not replace—the deterministic slot engine.

## Route 4: import Portless's public package API

Two subroutes exist:

1. Use `RouteStore` and utilities to register/reconcile against an existing Portless daemon.
2. Use `createProxyServer` inside the Workgrove daemon and provide Workgrove's own route table.

### Benefits

- Structured route access avoids parsing CLI output.
- Direct `RouteStore` use can perform owner-checked removal for PID-owned routes.
- Embedding `createProxyServer` lets Workgrove retain all route ownership in its controller while reusing Portless's carefully tested HTTP/2 and WebSocket proxy core.

### Problems

- `RouteStore`'s current schema has only a PID owner; aliases still cannot carry a Workgrove owner ID. Using internal state semantics directly couples Workgrove to a pre-1.0 file format.
- The public API does not expose certificate generation/trust, daemon/service management, free-port helpers, or complete discovery. An embedded proxy would still need substantial TLS/platform code.
- The package contract requires Node 24 while Workgrove promises Bun only. Even if Bun happens to run the built ESM, that is not an upstream compatibility guarantee.
- Importing the proxy into the same daemon increases blast radius: a proxy protocol bug could affect Workgrove's UI/control server.

### Better upstream API

Before adopting the package, propose a supported provider surface such as:

```ts
interface RouteOwner {
  provider: "workgrove";
  ownerId: string;
  revision: string;
}

routes.list({ format: "json" })
routes.put({ hostname, port, owner }, { ifUnownedOrOwnedBy: owner })
routes.remove({ hostname }, { ifOwnedBy: owner })
proxy.status({ format: "json" })
```

The exact syntax can be CLI, library, socket API, or MCP. The required semantics are structured data, namespaced ownership, conditional updates/removal, proxy capability/version reporting, and no implicit process termination.

### Verdict

Promising after upstream collaboration. Do not deep-import unpublished modules or read/write `routes.json` as an engine contract.

## Route 5: vendor or fork Portless

### Benefits

- Full control over route owner metadata, Bun compatibility, service lifecycle, UX, and release timing.
- Workgrove could embed one coherent proxy with its own state instead of sharing `~/.portless`.
- Apache-2.0 permits the approach.

### Costs

- Workgrove becomes responsible for CA lifecycle, keychain/trust-store behavior, `/etc/hosts`, launchd, IPv4/IPv6, HTTP/2 resets, WebSocket variants, proxy loops, Safari behavior, LAN exposure, and ongoing framework quirks.
- Portless's changelog shows active fixes across all of those areas, including a prior state-directory privilege-escalation issue and recent loopback, IPv6, HTTP/2, Tailscale, and worktree fixes ([changelog](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/CHANGELOG.md)). A fork would need continuous merging or independent security maintenance.
- Shipping modified source creates attribution/change-notice obligations and increases Workgrove's code and test surface substantially.

### Verdict

Use only if the upstream owner-scoped API is declined and named URLs become central enough to justify a proxy team inside Workgrove. Vendoring only `createProxyServer` is less costly than forking the whole CLI, but it still leaves TLS/service work unsolved.

## Route 6: no dependency; adopt Portless concepts

Workgrove could keep direct URLs and adopt only product ideas:

- display a stable logical endpoint name next to every raw port;
- separate assigned endpoint, listener health, process ownership, and route health;
- add `WORKGROVE_URL`/per-app URL environment values;
- use exact host routing and never wildcard by default;
- add host capability diagnostics similar to `portless doctor`;
- make friendly routes durable across process restarts and slot changes;
- expose a future routing-provider/MCP contract without choosing an implementation.

Alternatively, Workgrove could build a minimal plain-HTTP reverse proxy on an unprivileged port. That would prove the UX but would not reproduce the main benefits users expect from Portless—standard HTTPS, trusted certificates, HTTP/2, robust HMR, and no visible proxy port.

### Verdict

Keep this as the fallback and control group. It is also the correct answer for users who do not want CA/trust-store changes or another global service.

## Recommended routing-provider architecture

Routing should sit behind `WorkspaceController` or an internal module, consistent with Workgrove's existing host seams. Repository command code should not invoke Portless directly.

```text
WorkspaceController
  ├─ Slot/endpoint resolver        source of expected backing ports
  ├─ ProcessSupervisor            source of managed process ownership/logs
  ├─ ListenerInspector            source of actual listener/cwd ownership
  └─ EndpointRouter
       ├─ DisabledRouter
       └─ PortlessAliasRouter     optional host capability
```

Suggested internal contract:

```ts
interface EndpointRoute {
  id: string;              // stable Workgrove owner identity
  hostname: string;
  backingPort: number;
  protocol: "http";
}

interface EndpointRouter {
  status(): Promise<RouterStatus>;
  inspect(routes: EndpointRoute[]): Promise<RouteSnapshot[]>;
  reconcile(routes: EndpointRoute[]): Promise<ReconcileResult>;
  release(routeIds: string[]): Promise<ReleaseResult>;
}
```

`WorkspaceSnapshot` should preserve the direct endpoint and add route state rather than replace `url`:

```text
directUrl: http://localhost:3010
friendlyUrl: https://fix-ui.web.chat-js.localhost
routeState: disabled | unavailable | registered | conflict | degraded
listening: true
ownership: owned
```

The four axes must remain independent:

1. **Assignment:** which backing port the slot contract expects.
2. **Listener:** whether anything is actually listening there.
3. **Ownership:** whether the listener belongs to the worktree/managed process.
4. **Route:** whether a friendly hostname currently points to the expected backing port.

Portless route PID must not replace Workgrove's cwd/process/listener evidence.

## Configuration and naming

Routing should be opt-in only for endpoints that are actually HTTP. The current Workgrove app schema has only `basePort`, TCP health, and an assumed `http://localhost` URL, so it cannot distinguish a browser app from Postgres or Redis ([app schema](../src/config/workgrove-schema.ts), [health model](../src/runtime/app-health.ts)). A future-compatible shape could be:

```json
{
  "basePort": 3000,
  "protocol": "http",
  "route": { "enabled": true, "name": "web" }
}
```

Non-HTTP apps remain `protocol: "tcp"` with no Portless route.

Route identity must be globally unique across repositories and robust for detached HEADs. A possible display form is:

```text
<worktree-slug>-<worktree-id6>.<app-slug>.<repo-slug>-<repo-id6>.localhost
```

The short stable IDs are authoritative; branch/app/repo slugs are readability. This avoids depending on Portless's final-branch-segment heuristic and prevents two identically named repositories from colliding. Workgrove should validate DNS label length and reserved Portless command names before registration.

Provider enablement is user-level host configuration, not repository configuration. A repository may mark an HTTP endpoint as route-capable, but only the user can enable a Portless provider, select/trust its executable, authorize CA/service setup, or enable network/public exposure.

## Trust and safety rules

1. **Never automatically use `--force`.** It can terminate an unrelated route owner.
2. **Never infer executable trust from repository PATH.** Store an absolute user-approved Portless executable and version/capability result.
3. **Never let `.workgrove.json` install Portless, trust a CA, edit hosts, install a service, enable LAN, or create a public tunnel.**
4. **Never weaken repository command fingerprinting through Portless script inference.** If Workgrove wraps a process, fingerprint the complete effective command/config.
5. **Never delete an ambiguous route.** If owner evidence is missing or changed, report conflict and leave it untouched.
6. **Treat shared Portless state as another authority.** Workgrove's local registry records intent, not proof that the global route still belongs to Workgrove.
7. **Keep direct URLs visible.** Portless failure must not make a healthy local process appear unavailable.
8. **Make exposure visible.** Loopback, LAN, tailnet, and public funnel/ngrok are distinct security states.

## Phased route

### Phase 0 — architecture and manual proof

- Introduce no dependency.
- Define the `EndpointRouter` seam and split direct/friendly URLs in the snapshot model.
- Manually prove `portless alias <generated-name> <workgrove-port>` against a multi-app group, slot switch, HMR/WebSockets, stopped app, foreign port, detached worktree, and duplicate repo name.
- Confirm that Workgrove's current stop/log/ownership behavior is unchanged.

Success means the same friendly URL survives a slot switch, all direct endpoints still work without Portless, and no Portless action can kill a foreign process.

### Phase 1 — experimental external alias adapter

- Capability-detect a user-installed Portless and require the proxy/CA to be provisioned outside repository command execution.
- Route only explicitly marked HTTP apps.
- Use collision-resistant Workgrove names, persistent aliases, an internal intent registry, and no `--force`.
- Show provider/version/proxy/route health and actionable setup guidance.
- Keep this behind an experimental setting because reconciliation still depends on a human CLI contract without owner-scoped JSON.

### Phase 2 — upstream machine contract

- Propose and contribute JSON route/status output plus owner metadata and conditional put/remove semantics to Portless.
- Add conformance tests against a pinned supported Portless range.
- Promote the adapter only after route adoption/removal can be proven safe.

### Phase 3 — optional richer capabilities

- Add one-click user-approved service/CA setup.
- Expose LAN/Tailscale sharing only through explicit host-level confirmation.
- Consider `dynamic-http` allocation only as a separate endpoint mode.
- Re-evaluate importing the public package if Bun becomes supported and the needed route/cert/service APIs become public and versioned.

## Spike acceptance tests

At minimum, exercise:

- main, linked, and detached worktrees;
- two worktrees with the same final branch segment;
- two repositories with the same directory/package name;
- one app group with several HTTP apps;
- HTTP/1.1, HTTP/2, Vite/Next HMR, and WebSockets;
- a slot switch while preserving the friendly URL;
- a stopped/crashed app behind a persistent alias;
- a foreign listener on the expected backing port;
- an existing non-Workgrove Portless route with the desired hostname;
- missing Portless, wrong Node version, stopped proxy, untrusted CA, and non-interactive daemon execution;
- Workgrove daemon crash/restart and Portless proxy/service restart;
- route removal after worktree deletion without touching an ambiguous route;
- Portless upgrade across a supported pre-1.0 version range.

## Final decision

Portless is most valuable to Workgrove as **replaceable ingress infrastructure**. It should turn Workgrove's already-known HTTP endpoints into memorable, stable HTTPS URLs. It should not decide which worktrees exist, which slots they use, which commands are trusted, which processes Workgrove owns, or whether a listener is safe to stop.

The recommended sequence is therefore:

> Preserve Workgrove's engine, add a routing-provider seam, ship an experimental external Portless alias adapter, and work upstream toward owner-scoped machine-readable routes before making it a default integration.
