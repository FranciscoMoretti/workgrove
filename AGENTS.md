# Workgrove contributor instructions

- Use Bun for dependencies, scripts, tests, and local development.
- Keep repository-specific behavior in `.workgrove.json`; do not add project-name or folder-name conventions to the product.
- Keep Git, configuration, port inspection, process ownership, and command rules behind `WorkspaceController` or its internal modules.
- Treat repository commands as untrusted until their command fingerprint is explicitly approved.
- Run `bun lint`, `bun test:types`, `bun test`, and `bun build` before handing off changes.
- Workgrove is macOS-first. Platform-dependent behavior belongs behind the host or process-inspection seams.

## Agent skills

### Issue tracker

Issues and planning artifacts are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Workgrove uses a single-context domain model. See `docs/agents/domain.md`.
