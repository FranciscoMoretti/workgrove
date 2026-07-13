# Workgrove domain glossary

## Repository command profile

The per-repository definition of the commands Workgrove may run. A profile can
replace Workgrove's defaults and applies to every worktree of that repository.
Repository trust is a one-time decision and is not tied to command revisions.

## Setup

A finite repository command that prepares a worktree for development. Setup is
independent of whether the development runtime is started or stopped.

## Start

A long-running repository command that launches the development runtime for a
worktree and becomes managed by Workgrove.

## Stop

A lifecycle command that terminates the development runtime managed by
Workgrove. Stop does not run a repository-supplied shell command and does not
terminate an independent Setup process.

## Restart

A lifecycle command that completes Stop and then performs Start for the same
worktree.

## Managed runtime

The development process or processes launched by Start and owned by Workgrove
for one worktree.
