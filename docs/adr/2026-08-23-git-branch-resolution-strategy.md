# Git Branch Resolution Strategy

- **Status**: Accepted
- **Date**: 2026-08-23
- **Deciders**: Integralist

## Context

The status bar needs to display the active Git branch alongside the current
working directory (`~/path (<branch_name>)`) when on any non-main branch. The
status bar renders frequently during active streaming turns (up to multiple
times per second). Spawning a subprocess on every frame causes latency spikes
and CPU overhead, while reading `.git/HEAD` manually fails to handle Git
worktrees, submodules, and custom gitdirs cleanly.

## Decision

We will use `git symbolic-ref --short HEAD` via `execFileSync` with a 2-second
in-memory TTL cache keyed by working directory.

## Options Considered

- **Subprocess with 2-second TTL Cache (Chosen)** — Fast (<5ms), robust across
  all Git topologies (worktrees, submodules, standard repos), and eliminates
  per-frame process spawning overhead.
- **Direct Filesystem Inspection (`.git/HEAD`)** — Avoids subprocesses
  entirely, but requires parsing `.git` files, worktree gitdirs, packed refs,
  and relative gitdir paths, creating high maintenance overhead and fragility.
- **Asynchronous Periodic Poller** — Updates branch state on an interval in
  the background, but introduces timer management, unneeded background
  activity during idle periods, and lifecycle cleanup requirements.

## Consequences

- Active branch changes outside the session will reflect in the statusline
  within at most 2 seconds.
- Subprocess execution is capped at once every 2 seconds per distinct working
  directory.
- Silent fallback on errors ensures zero crashes when Git is not installed or
  the directory is not a Git repository.
