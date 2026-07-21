# ADR 0002: Use a slot-free repository schema and local state

Status: Accepted on 2026-07-18.

This decision defines the checked-in repository declaration and the user-local
records needed by [ADR 0001](./0001-portless-runtime.md). It replaces the
unreleased slot-based model without a compatibility requirement.

## Sources of truth

`.workgrove.json` is the checked-in opt-in marker for a Workgrove-capable repository and the only source of truth for repository-specific topology and behavior. It declares Setup, app groups, lifecycle commands, apps, protocols, readiness, and group environments. The dashboard continues to edit this file in the repository.

User-local state records only user-created relationships and Workgrove-owned assignments. It does not mirror or override repository configuration.

Live queries remain the source of truth for processes, listeners, readiness, and routes. Workgrove never persists Running, Partial, Stopped, Ready, Failed, or similar conclusions.

## Repository schema

The intended shape is:

```json
{
  "$schema": "https://raw.githubusercontent.com/franciscomoretti/workgrove/main/schema/workgrove.schema.json",
  "version": 1,
  "setup": {
    "argv": ["bun", "install"]
  },
  "appGroups": {
    "development": {
      "name": "Development",
      "start": {
        "argv": ["bun", "run", "dev"]
      },
      "stop": "process",
      "env": {
        "WEB_PORT": "{apps.web.port}",
        "API_PORT": "{apps.api.port}",
        "API_URL": "{apps.api.url}"
      },
      "apps": {
        "web": {
          "name": "Web",
          "protocol": "http",
          "readiness": {
            "type": "http",
            "path": "/",
            "statuses": "200-399"
          }
        },
        "api": {
          "name": "API",
          "protocol": "http",
          "readiness": "tcp"
        }
      }
    },
    "services": {
      "start": {
        "argv": ["docker", "compose", "up", "-d"]
      },
      "stop": {
        "argv": ["docker", "compose", "down"]
      },
      "env": {
        "DATABASE_PORT": "{apps.database.port}"
      },
      "apps": {
        "database": {
          "protocol": "tcp",
          "readiness": "tcp"
        }
      }
    }
  }
}
```

The schema version is the new public schema's own version; it does not imply migration from the unreleased slot-based version.

## Stable logical IDs and display names

The keys under `appGroups` and `apps` are readable, stable logical IDs. An optional `name` is a mutable display label. Editing a display label preserves local endpoint identity and Friendly URLs. Manually changing a logical ID is delete-and-create; an explicit future migration operation may preserve identity across such a change.

Workgrove combines repository and worktree identity with the stable group and app IDs when assigning a local endpoint identity. It does not put opaque UUIDs in the checked-in file.

## Commands

A command is a shell-free `argv` array with an optional worktree-relative `cwd`. Template references may appear in individual argv entries. Setup and lifecycle commands run inside the worktree, and `cwd` must remain within it.

Every app group defines Start and one of two Stop strategies:

- `"stop": "process"` means Workgrove owns and terminates the foreground process group and its verified worktree-owned listeners.
- A Stop command supports external runtimes such as Docker whose services may outlive the process that started them.

Workgrove may manage a still-running Start process even when the group also has a Stop command. During Stop it removes routes, runs the Stop command, terminates any surviving managed starter, verifies listeners, and only then releases Backing endpoints. A failed Stop quarantines endpoints still reachable by a route or listener and remains retryable.

## App-group environment

Environment declarations live on the app group because they belong to that group's process. Workgrove inherits the host environment and overlays the group's explicit values. Setup inherits the host environment but receives no runtime endpoint bindings.

Within a group, templates may reference:

- `{apps.<app>.host}`;
- `{apps.<app>.port}`;
- `{apps.<app>.directUrl}` for HTTP apps; and
- `{apps.<app>.url}` for an HTTP app's Friendly URL.

Cross-group templates may reference only an HTTP app's stable Friendly URL through `{appGroups.<group>.apps.<app>.url}`. Cross-group Backing ports and direct URLs are invalid because the referenced group may not be running or allocated.

Workgrove does not infer a generic `PORT`, `PORTLESS_URL`, or framework flag. A repository consumes dynamic values explicitly through environment or argv templates. Changing the resolved environment requires Restart.

## Protocol and readiness

Every app explicitly declares one protocol:

- `http` receives host, port, direct URL, and Friendly URL bindings and is eligible for Portless routing, including WebSocket upgrades.
- `tcp` receives host and port bindings and is observed directly; it has no Portless Friendly URL.

Owned TCP-listener readiness is the default. An HTTP app may configure an HTTP path and accepted status range. Workgrove uses a 60-second startup timeout unless an app overrides it. Timeout produces an Unready or Partial live observation and does not kill the app group.

## Repository-wide trust

Trust remains one repository-wide decision, not one approval per command. Workgrove fingerprints the repository's complete execution contract: Setup, every Start and Stop command, relative working directories, environment and argv templates, and app declarations that control generated runtime values. Dynamic allocations such as chosen port numbers do not change the fingerprint.

Opening an untrusted repository remains safe for inspection, but Workgrove will not execute its commands until the user approves the current repository fingerprint. A changed execution fingerprint requires one new repository-wide approval.

## Tracked repositories

Opening or initializing a repository adds it to a user-local repository inventory. This inventory supports repository switching and the cross-repository Running overview without relying on browser storage.

If `.workgrove.json` disappears, the repository remains tracked and is shown as not configured. Only an explicit Remove repository action removes it from the inventory and retires its local assignments after safe runtime cleanup.

For the first implementation, canonical repository and worktree paths are lookup keys. Workgrove also assigns local IDs so the storage model does not expose paths as domain identity. Moving a repository or worktree may require adding it again and may produce new Friendly URLs. Git-common-directory-based move detection is deferred.

## Persisted local records

The first implementation uses a single versioned, atomically replaced JSON state file under `~/.workgrove`, behind a `LocalStateStore` interface. The daemon is its sole writer. Logs and Workgrove's private Portless state remain separate.

The local state may persist only:

- repositories explicitly opened or initialized by the user;
- repository-wide trust fingerprints explicitly approved by the user;
- generated repository, worktree, app-group, and app identities;
- stable route-label and Friendly URL assignments;
- Backing endpoint leases and quarantines created by Start or Stop;
- process PID and start marker records created when Workgrove launches a process; and
- expected Portless hostname-to-port routes created during lifecycle operations.

These run records describe Workgrove-owned allocations and ownership evidence, not health. Start writes the allocation record before executing repository code. Stop removes it only after routes, processes, listeners, and leases are safely reconciled.

Workgrove does not persist Desired state or any queried runtime conclusion. Starting and Stopping come from the active lifecycle operation. Running, Partial, Stopped, readiness, process state, and route state are recomputed from the current operation plus live process, listener, readiness, and Portless queries.

On daemon restart, Workgrove revalidates every persisted ownership and allocation record before using it. On machine reboot, absent processes and listeners are observed as Stopped; no repository command runs automatically. Stale allocations are released only after Workgrove verifies that no live listener or route can reuse them unsafely.
