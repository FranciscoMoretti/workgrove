# Endpoint, route, and environment contract

Status: Accepted on 2026-07-18.

This contract turns the [Portless runtime proof](./portless-runtime-proof.md) into Workgrove product semantics. It describes ownership and observable behavior; the slot-free `.workgrove.json` and user-local state shapes are a separate design decision.

## Ownership boundary

Workgrove owns endpoint identity, route naming, Backing endpoint allocation, repository command trust, process lifecycle, environment construction, readiness, logs, and runtime reconciliation. Portless is an always-available local routing engine controlled through Workgrove-exclusive state. It owns proxying a configured hostname to a Backing endpoint, not application discovery or lifecycle.

Workgrove must not infer product identity from Portless process names, paths, ports, or aliases.

## Stable identity and names

Workgrove persists opaque local identities for each repository, worktree, app group, and app. Display names, branches, and generated slugs are not identity. Stable logical app-group and app IDs in `.workgrove.json` associate checked-in definitions with their local identities.

Changing a display name does not change identity or an assigned Friendly URL. Changing a logical group or app ID is delete-and-create unless an explicit migration reconnects it. The first implementation uses canonical paths to associate repositories and worktrees, so moving one may require adding it again; stronger move detection is deferred.

Every Friendly URL includes a repository route label:

```text
http://<app>.<worktree>.<repository>.localhost
```

The three labels are assigned once and persisted. Repository labels are unique within Workgrove's local routing namespace, worktree labels are unique within their repository, and app labels are unique within their worktree even when the apps belong to different groups. A readable slug is used when available; if it is already reserved by a different identity in that scope, Workgrove appends a stable identity-derived suffix. Allocation must reject rather than overwrite any remaining duplicate hostname.

This makes URL allocation deterministic for an identity and removes the order-dependent rule where the first repository received an unqualified hostname.

## Backing endpoint allocation

On every Start, Workgrove allocates all Backing endpoints needed by the app group as a single plan before executing repository code. Allocation is dynamic, and ports may change on every Start. Workgrove verifies availability and retains ownership of the allocation through route deactivation.

The normal model has no slots, stride, or required base ports. Optional reserved ports remain deferred.

## Independent runtime dimensions

Workgrove observes independent runtime dimensions rather than collapsing or persisting them as one health value:

- Process state: `stopped | starting | running | stopping | exited | failed`
- Per-app readiness: `waiting | ready | unready`
- Per-app route: `inactive | activating | active | deactivating | conflict | unavailable`

An active Lifecycle operation supplies transient Starting or Stopping state. Dashboard summaries such as Running, Partial, Stopped, Failed, and Routing error are live projections of operations, processes, listeners, readiness, and routes; Workgrove does not persist them as desired or observed status.

## Start

Start follows this order:

1. Verify that the controlled Portless runtime is available.
2. Allocate and durably record every Backing endpoint for the app group.
3. Construct the complete app-group environment.
4. Launch the repository-wide trusted command.
5. Verify each app's listener and configured readiness condition.
6. Activate an exact Friendly URL route only for a ready app.
7. Observe that the exact hostname routes to the expected Backing endpoint.
8. Expose Open and Copy URL actions for that app.

Start and Open are separate actions. Knowing a Friendly URL before launch does not make it clickable before readiness and route activation are observed.

If only some apps become ready, Workgrove keeps the group process running, marks the group Partial, exposes links only for ready apps, and offers logs, retry, Restart, and Stop. It does not automatically terminate a useful partial process.

## Stop and Restart

Stop follows this order:

1. Deactivate each Friendly URL route.
2. Observe that each route is inactive.
3. Run the trusted repository Stop command when one is configured.
4. Terminate any surviving Workgrove-managed starter process.
5. Verify that app listeners have disappeared.
6. Release the app group's Backing endpoints.

If route deactivation or a repository Stop command fails, Workgrove still terminates its managed process so Stop remains under user control. It keeps routes disabled where possible, quarantines any affected or still-listening Backing port, and does not make that port available to another process until both the route and listener are observed inactive. The app group reports a Stop failure that the dashboard can surface and retry.

Restart completes Stop before performing Start. It receives fresh Backing endpoints and a freshly constructed environment while retaining endpoint identity and Friendly URLs.

## Crash and recovery

A process crash changes the next live observation; Workgrove does not retain a Desired-running flag and does not auto-restart repository commands. Durable logs and Workgrove-created ownership records may explain the failure, but they are not a persisted Running or Failed status.

After Workgrove itself restarts, it may re-adopt a surviving managed process after verifying its identity, ownership, listeners, and routes. After a machine reboot, Workgrove does not automatically execute repository commands. Absent processes and listeners are simply observed as Stopped, and stale Workgrove-owned allocations are reconciled safely.

## Readiness and route verification

The default readiness condition is an owned TCP listener on the allocated Backing port. A repository may configure an HTTP readiness path and accepted status codes per app. TCP remains the default because valid development applications may return authentication, redirect, or not-found responses at `/`.

Readiness proves the application is accepting traffic. Route activation separately proves that the exact Friendly URL reaches the expected Backing endpoint. A route is `active` only after this observation; successful completion of a Portless CLI command alone is insufficient.

## Environment

Workgrove determines the complete environment before launching the app-group command. Every binding is explicit in repository configuration. An app may expose:

- its Backing port;
- its direct URL; and
- its stable Friendly URL.

Friendly URLs are allocated before launch and may therefore be passed to peer applications even though dashboard links remain unavailable until routes are active. In configuration templates, an app's `url` denotes its Friendly URL and `directUrl` denotes its Backing URL.

Workgrove does not inject a generic `PORT` or `PORTLESS_URL` unless repository configuration explicitly maps that variable to one app binding. Provider variables such as a local certificate path are injected only when required and must not silently overwrite an explicit repository value. Changing the resolved environment requires Restart; Workgrove never mutates a running process environment.

## Portless failures

If Portless preflight fails, Start fails before Workgrove executes untrusted repository code.

If Portless becomes unavailable after the process launches, Workgrove keeps the process running, records a Degraded routing state, preserves logs, exposes direct endpoints for diagnostics, and offers route retry and normal lifecycle actions. It does not kill the process merely because local ingress failed.
