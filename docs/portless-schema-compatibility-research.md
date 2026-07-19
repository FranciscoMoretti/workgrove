# Portless discovery and Workgrove schema compatibility

_Research snapshot: 18 July 2026. Portless was inspected at version `0.15.4`, commit [`e0c2af5`](https://github.com/vercel-labs/portless/tree/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26). Portless claims below cite that commit's official README or source. Workgrove claims cite this repository._

## Conclusion

The focused-console product model is compatible with Portless, but **Portless discovery cannot be the source of truth for it**.

The sound contract is:

1. Workgrove owns stable endpoint identity, app-group topology, repository command trust, process ownership, and the environment exported to each app group.
2. Workgrove allocates or otherwise knows every backing port before it launches a group.
3. Workgrove maintains a user-local intent registry assigning one durable friendly hostname to each HTTP app endpoint.
4. Portless is a replaceable routing provider that activates those hostnames only while the expected Workgrove-owned listeners are present.
5. Existing `{...port}` and `{...url}` environment templates remain backward compatible. Friendly URLs are exposed through new, explicit template fields rather than silently changing what `url` means.

This preserves the proposed UI promise: Workgrove can show a stable **known address** before an app starts, `Run environment` needs no slot choice, and restarting on different backing ports does not change that address. “Known” must not imply that Portless currently reserves or serves the route.

There is one material blocker before this is safe to ship as an automatic integration: Portless's static-alias interface has no owner namespace or conditional update/remove operation. In fact, all aliases use PID `0`, so a second `portless alias` call for the same hostname can replace an existing alias without `--force`. Workgrove therefore cannot prove from the public CLI that an alias is still its own before changing or deleting it. The initial implementation must be experimental, collision-resistant, conservative on ambiguity, and ideally paired with an upstream owner-scoped machine API.

## What Portless actually discovers

### Single-app mode

`portless run` infers a base name from the nearest `package.json` name, then the Git root directory, then the current directory. In a **linked** Git worktree, it may prefix that name with a branch label. This is CLI convenience, not durable identity ([name inference](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/auto.ts#L46-L88), [worktree detection](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/auto.ts#L153-L268)).

The worktree prefix has several limitations for Workgrove:

- only linked worktrees receive a prefix;
- the main/root checkout does not, even if it is on a feature branch;
- `main` and `master` are unprefixed;
- detached HEAD is unprefixed;
- only the final branch path segment is used, so `feature/auth` and `fix/auth` both become `auth`.

Workgrove already has canonical repository/worktree/app context and must not reconstruct it from this heuristic.

There is also an important CLI distinction: `portless <exact-name> <command>` uses the caller's name directly, while `portless run --name <name>` still applies Portless's inferred worktree prefix ([named mode](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L4079-L4122), [run mode](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L4029-L4075)). Any wrapper experiment must use exact named mode, not inference.

`portless get <name>` is also not discovery: it formats the URL implied by the current proxy configuration and optional worktree prefix; it does not check whether the named route exists ([implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2197-L2256)). `portless list` reads live routes but emits human-formatted text, not a documented JSON contract ([implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L976-L1000)).

### Monorepo mode

A bare `portless` at a workspace root discovers packages from `pnpm-workspace.yaml` or the `workspaces` field in `package.json`, runs one selected package script per package, and normally gives each server package a separate route. Names default to `<package>.<project>` and can be overridden through `portless.json` or the package's `portless` key ([official monorepo contract](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#monorepo), [workspace discovery](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/workspace.ts#L13-L126), [multi-app orchestration](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L3485-L3797)).

That is not the same abstraction as a Workgrove app group:

- Portless owns one child process per discovered workspace package.
- Workgrove owns one trusted start command per app group; that command may launch several apps from any language or tool, not necessarily workspace packages.
- Portless classifies unknown package scripts as servers unless configured otherwise; Workgrove declares the expected endpoints explicitly.
- Portless's multi-app configuration describes package paths, scripts, names, and optional fixed ports. It has no equivalent to Workgrove's independently slotted groups or cross-group environment templates ([Portless config shape](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/config.ts#L11-L21), [Workgrove schema](../src/config/workgrove-schema.ts)).

Portless monorepo discovery is therefore useful prior art, but should not replace `.workgrove.json` discovery.

## Exact Portless launch and route contract

### Backing-port allocation

Unless `--app-port` or `PORTLESS_APP_PORT` supplies a fixed value, Portless probes for a free TCP port in `4000–4999`. It tries random ports and then scans sequentially. Its source explicitly notes the check-to-bind race between releasing the probe socket and the child binding the port ([free-port implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L685-L727), [documented options](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#options)).

For a single app, the route is registered before the child is launched. The hostname points at the chosen loopback port and the route owner is the Portless CLI wrapper's PID, not the eventual listener PID ([registration and environment](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L1283-L1307), [child launch](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L1452-L1528)).

### Child environment

Portless inherits the parent environment and adds or changes the following for a proxied child ([official environment list](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#environment-variables), [single-app construction](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L1452-L1510)):

| Variable | Semantics |
|---|---|
| `PORT` | The one backing port allocated to this child. |
| `HOST` | Usually `127.0.0.1`; omitted for Expo in LAN mode. |
| `PORTLESS_URL` | This child's primary public URL. |
| `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` | The configured TLDs so Vite accepts the proxied `Host` header. |
| `PORTLESS_LAN` | Propagated when LAN routing is active. |
| `PORTLESS_TAILSCALE_URL` | Added when Tailscale sharing is active. |
| `PORTLESS_NGROK_URL` | Added when ngrok sharing is active. |
| `NODE_EXTRA_CA_CERTS` | Set to Portless's CA when HTTPS is active and the user did not already set it. |

For known frameworks that ignore `PORT`, Portless additionally mutates the command arguments to add framework-specific `--port`, `--host`, or strict-port flags ([framework injection](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L1014-L1134)).

In direct-spawn monorepo mode, every package child receives its **own** `PORT`, `HOST`, and `PORTLESS_URL` ([multi-app child environment](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L3541-L3613)). In Turborepo mode, Portless writes a manifest keyed by absolute package directory and prepends a Node loader through `NODE_OPTIONS`; the loader copies that package's entry into `process.env` based on `process.cwd()` ([Turbo orchestration](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L3800-L3914), [manifest/loader](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/turbo.ts#L16-L93)).

Portless does **not** export a map of peer URLs or ports to each child. `PORTLESS_URL` is only the current child's self URL. Cross-service discovery remains the repository's responsibility.

### Command and process ownership

In single-app mode on Unix, Portless launches the command through `/bin/sh -c` in a detached process group, forwards `SIGINT`/`SIGTERM` to the group, propagates its exit status, and invokes route cleanup ([spawn implementation](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L925-L1011)). The managed route belongs to the Portless wrapper PID. Clean exit removes only routes that still carry that PID, protecting a later `--force` takeover from the old owner's cleanup ([owner-checked removal](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L353-L372)).

Wrapping a Workgrove start command would consequently nest Portless's process group inside Workgrove's detached process group. It would also give one group command only one meaningful `PORT` and `PORTLESS_URL`, which is incorrect for a group that launches Web, API, and other endpoints together.

### Persistence and collisions

Portless stores routes in a shared per-user `routes.json`, normally under `~/.portless`, with a filesystem lock. A route contains `hostname`, `port`, and `pid`, plus optional sharing metadata ([route schema and paths](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L18-L90), [state-directory resolution](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli-utils.ts#L188-L209)).

There are two lifecycle classes:

- A `run` route has a nonzero wrapper PID. Dead-owner routes are filtered as stale, and normal cleanup removes the route. The hostname may be repeatable, but the active mapping is not reserved while the app is stopped.
- An `alias` route has PID `0`. PID-zero routes are retained across cleanup and proxy restarts until explicitly removed ([stale filtering](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L168-L205), [alias registration](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2258-L2322)).

The PID-zero persistence should not be interpreted as a safe stopped state. If an alias remains pointed at an inactive port, an unrelated process can later bind that port and receive traffic for the Workgrove hostname. Workgrove should retain the **hostname assignment** in its own registry but activate a provider route only after it has verified the expected listener's ownership, then deactivate it before the port is released. When no route is registered, Portless returns its unregistered-route response; the UI should say “Known address · app stopped,” not “Reserved in Portless” ([unregistered route behavior](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts#L202-L221)).

A live non-alias route conflict throws unless `--force` is used; `--force` sends `SIGTERM` to the recorded owner before replacing it ([conflict behavior](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L216-L250)). Workgrove must never use `--force` automatically.

Static aliases have a subtler and more serious ownership problem. `RouteStore.addRoute` treats equal PIDs as the same owner. Because every alias uses PID `0`, registering the same alias name again replaces the earlier alias even without `--force`; no Workgrove owner ID is checked. `alias --remove` likewise removes a PID-zero route by hostname, with no conditional owner token ([equality check](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/routes.ts#L222-L250), [alias add/remove path](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/cli.ts#L2281-L2321)).

This means a Workgrove registry can record intent, but cannot by itself prove ownership of shared Portless alias state.

## Compatibility with the current Workgrove schema

Workgrove v2 declares independently slotted app groups. Every app has a `basePort`; a group's slot and stride determine the backing port as `basePort + slot * stride` ([schema and resolver](../src/config/workgrove-schema.ts)). The config's top-level `env` map can interpolate the slot, port, and direct URL of **every app in every group** ([template implementation](../src/config/workgrove-template.ts), [environment resolution](../src/config/workgrove-config.ts)).

The same resolved environment is passed to the app group's one trusted start command ([start path](../src/commands/start-apps.ts)). The process supervisor then merges it over the host environment and launches the command directly, while retaining Workgrove's PID, cwd, logs, and process-group ownership model ([supervisor](../src/runtime/process-supervisor.ts)).

For example, one group can launch two apps using:

```json
{
  "appGroups": {
    "Product Apps": {
      "apps": {
        "Web": { "basePort": 3000 },
        "API": { "basePort": 8000 }
      }
    }
  },
  "env": {
    "WEB_PORT": "{appGroups.Product Apps.apps.Web.port}",
    "API_PORT": "{appGroups.Product Apps.apps.API.port}"
  }
}
```

This contract is stronger for Workgrove's model than Portless's one-child/one-`PORT` convention. It lets a group-level orchestrator launch several processes and gives every process enough information to find its peers.

Therefore:

- Do not wrap a multi-app group once with `portless run`; it can only describe one primary endpoint correctly.
- Do not delegate the group's ports to Portless; Workgrove must resolve the whole environment before the group command starts.
- Do not replace Workgrove's app-group discovery with Portless workspace discovery; they describe different topology.
- Use Portless aliases after Workgrove resolves the backing endpoints, or add a future dynamic mode only for deliberately single-app HTTP groups.

The current app schema also needs one production clarification: an app declares only `basePort`, while the health layer performs a TCP probe and constructs an HTTP URL for every app. Portless is an HTTP/HTTPS reverse proxy with WebSocket handling, not a general raw-TCP router ([proxy request path](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts#L139-L152), [upstream routing](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/src/proxy.ts#L243-L270)). Before production routing, each endpoint should declare at least `protocol: "http" | "tcp"` (with a migration-compatible default) and only HTTP endpoints should be eligible for a friendly Portless route. Databases, Redis, SMTP, UDP, and other non-HTTP services keep direct host/port environment values.

## Recommended stable mapping

Workgrove should maintain a user-local route-intent registry beside its other host control state, not in checked-in `.workgrove.json` and not solely in Portless's shared state.

Conceptually:

```json
{
  "version": 1,
  "routes": {
    "<stable-route-id>": {
      "repositoryId": "<stable-local-repository-id>",
      "worktreeId": "<workgrove-worktree-id>",
      "appGroup": "Product Apps",
      "appId": "Web",
      "protocol": "http",
      "hostname": "feature-login-a1b2.web.chat-js-c3d4.localhost",
      "provider": "portless",
      "lastBackingPort": 3010
    }
  }
}
```

Important semantics:

1. Allocate the hostname once and retain it across ordinary stop/start, branch rename, and backing-port changes. Human-readable slugs are decoration; short stable IDs prevent cross-repository and same-branch collisions.
2. Key intent by repository + Workgrove worktree identity + app group + app ID, not Portless's inferred branch/package name.
3. Keep the hostname assigned while the app is stopped, but do not leave a Portless alias aimed at a reusable inactive port. “Known” is Workgrove registry state, not provider reservation.
4. After Workgrove verifies an owned listener, activate the provider route. Before stopping/releasing its port, deactivate that route. On automatic port reassignment, update only `lastBackingPort` and re-register the same hostname.
5. Treat the registry as desired state, not proof of Portless ownership. If observed provider state differs and ownership cannot be proven, report `conflict` and leave it untouched.
6. Never delete an ambiguous alias during worktree cleanup. Owner-scoped conditional removal is required for automatic garbage collection.

This registry should be user-level because Portless routes are user-global and must avoid collisions across all repositories. `.workgrove.local.json` currently stores per-worktree slot assignments; overloading it would not provide a cross-repository namespace ([slot-state format](../src/runtime/slot-file.ts)).

## Environment-variable design for app groups

### Preserve the existing meaning

Changing `{appGroups.<group>.apps.<app>.url}` from `http://localhost:<port>` to a Portless URL would be a silent breaking change. Repositories may use that value for raw health checks, non-browser clients, or startup coordination.

Keep these tokens:

```text
{...port}  -> numeric backing port
{...url}   -> existing direct http://localhost:<port> URL
```

Add explicit route-aware values:

```text
{...directUrl}    -> http://localhost:<port> (clear alias of existing url)
{...friendlyUrl}  -> durable Portless URL when routing is configured
{...effectiveUrl} -> friendly URL when the provider is usable, otherwise direct URL
```

The repository then chooses the semantics it needs:

```json
{
  "env": {
    "WEB_PORT": "{appGroups.Product Apps.apps.Web.port}",
    "WEB_DIRECT_URL": "{appGroups.Product Apps.apps.Web.directUrl}",
    "WEB_URL": "{appGroups.Product Apps.apps.Web.effectiveUrl}",
    "API_PORT": "{appGroups.Product Apps.apps.API.port}",
    "API_URL": "{appGroups.Product Apps.apps.API.effectiveUrl}"
  }
}
```

There is a product decision behind `effectiveUrl`: if a configured friendly route is a hard dependency for the group, fail before launch when the provider is unavailable; if routing is an enhancement, resolve it to the direct URL and visibly mark routing unavailable. Do not change this value after the process has launched—restart the group if its exported environment needs to change.

### Do not inject a generic `PORT` or `PORTLESS_URL` for a multi-app group

A Workgrove group with several apps has no single correct value for either variable. Automatically setting them would privilege one app and could override repository behavior. Continue using the explicit, namespaced variables from `.workgrove.json`.

For a deliberately single-app HTTP group, a future compatibility mode could additionally export `PORT` and `PORTLESS_URL`, but it must be explicit and must participate in the trusted effective-command/environment fingerprint.

### Provider runtime variables that may still be needed

Using static aliases means Portless does not wrap the repository process and therefore does not perform its normal child-environment/flag injection. Workgrove must account for the useful parts separately:

- `NODE_EXTRA_CA_CERTS`: Node server-side requests to friendly HTTPS URLs need Portless's CA. Workgrove may add this only when HTTPS routing is active, the CA path is trusted/validated, and the user has not already set the variable. Never overwrite an existing value.
- `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`: Vite may reject the Portless `Host` header without this. A Portless provider can add the configured TLDs to the group environment, again without overriding an explicit repository value.
- framework port flags: Workgrove's schema already requires repositories to consume their named port variables. The alias adapter should not mutate trusted command argv behind the repository's back.
- `HOST`: do not impose Portless's single-app default on the whole group. Each repository remains responsible for binding its apps compatibly with its declared endpoints.

These provider additions belong in the resolved runtime environment and its trust/debug view; they should not be hidden side effects.

## What can and cannot be proved with Portless 0.15.4

### Proven compatible by contract

- Portless can route any number of distinct hostnames to distinct loopback ports.
- Workgrove already knows all app endpoints in a group before launch.
- Workgrove can preserve a hostname in its registry while deactivating and reactivating the Portless route against a different backing port.
- Keeping Workgrove as the launcher avoids nested supervision and preserves its listener ownership, stop, and logging behavior.
- Workgrove's cross-app environment map can export stable friendly URLs before the group starts because hostname allocation is Workgrove-owned and does not depend on discovering a running child.

### Not yet safe enough for unattended reconciliation

- The public CLI cannot list routes as structured JSON.
- Static aliases carry no Workgrove owner ID or revision.
- Alias-to-alias replacement is not owner-checked.
- Alias removal is not conditional on a Workgrove owner token.
- Portless is pre-1.0 and warns that its state format can change; importing `RouteStore` couples Workgrove to that format ([stability warning](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/README.md#install)).
- The package's published engine contract currently requires Node 24+, while Workgrove is Bun-first ([Portless package](https://github.com/vercel-labs/portless/blob/e0c2af5734fcdc2f6c6992423a023d8ec0c68e26/packages/portless/package.json#L20-L26)).

## Recommended proof before building the focused UI

Build a narrow engine spike, not the full interface:

1. Add no schema migration initially. Resolve the existing Web and API backing ports for two worktrees.
2. Allocate four collision-resistant friendly names in a temporary Workgrove intent registry.
3. Start the apps, verify Workgrove owns their listeners, then register Portless aliases without `--force` and verify each hostname reaches only its expected app.
4. Start both worktrees together and confirm every app receives the current Workgrove environment, not a single Portless `PORT`.
5. Deactivate its aliases before stopping one group, restart it on a different backing slot, re-register the same hostnames, and verify the friendly URLs do not change.
6. Verify server-to-server requests through friendly HTTPS with the CA environment and Vite/HMR through the proxy.
7. Exercise main, linked, detached, same-final-branch-name, and duplicate-repository-name cases; names must remain distinct without relying on Portless inference.
8. Pre-create a foreign live route and a foreign PID-zero alias at a desired name. The spike must never use `--force`, overwrite it, remove it, or stop its process; it must surface a conflict.
9. Kill Workgrove and restart it. Reconcile only exact matches; leave every ambiguous provider route untouched.
10. Stop the Portless proxy or remove Portless. Direct URLs and Workgrove process control must continue to function.

The focused-console design is justified if this spike demonstrates stable friendly identity, correct cross-app environment export, unchanged Workgrove ownership semantics, and conservative collision behavior. Automatic garbage collection should remain disabled until Portless exposes owner-scoped conditional route operations.

## Required upstream capability for a production adapter

The missing contract can be small:

```ts
interface RouteOwner {
  provider: "workgrove";
  ownerId: string;
  revision: string;
}

routes.list({ format: "json" });
routes.put(route, { ifUnownedOrOwnedBy: owner });
routes.remove(hostname, { ifOwnedBy: owner });
proxy.status({ format: "json" });
```

Until Portless has equivalent semantics through a documented CLI, library, or socket API, Workgrove can prove routing behavior but not safe shared-state ownership. That is the precise boundary between a useful prototype and a production-quality engine integration.
