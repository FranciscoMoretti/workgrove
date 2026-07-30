# Adopt the BranchBase namespace

BranchBase replaces the unreleased identity with one clean public namespace: `BranchBase` for the product, `branchbase` for the package and CLI, `.branchbase.json` for repository configuration, `~/.branchbase` for local state, and `BRANCHBASE_*` for environment variables. The rename deliberately provides no compatibility aliases or automatic migration because preserving an unreleased namespace would leave two public contracts for every integration surface.
