# Pi Statusbar Extension — Specification

- **Status**: Draft
- **Author**: Integralist
- **Created**: 2026-08-23
- **Language**: TypeScript

## Problem Statement

The default statusline in the Pi coding agent provides minimal telemetry and
context visibility during long-running sessions. Developers need immediate
glanceable information on their active directory, current Git branch context,
selected model and thinking effort, context window utilization, streaming
token throughput (TTFT and TPS), and accrued session cost. When switching to a
feature branch, users lack immediate visual confirmation of the branch context
directly in the status line without running a manual terminal command.

## Solution

A custom footer extension for Pi that replaces the stock footer with a rich,
modular, left-aligned telemetry status bar. The bar renders CWD (middle-truncated
with home directory replacement) enriched with the active Git branch name in
parentheses whenever the working directory is on a branch other than `main`. It
also displays the active model and effort level, context window percentage and
capacity, live TTFT/TPS token metrics, and session cost, with optional MCP tool
counts on the right, and provides a `/statusbar` command for interactive
segment configuration.

## User Stories

1. As a developer working across branches, I want the status bar to display
   `~/path (branch_name)` when I am not on the `main` branch, so that I never
   lose track of my active branch context.
2. As a developer working on `main`, I want the status bar to display only
   `~/path` without a branch annotation, so that the status bar remains clean
   and uncluttered during trunk development.
3. As a developer monitoring model performance and spend, I want real-time
   TTFT, TPS, context percentage, and session cost in the footer, so that I can
   track token throughput and spend without leaving the conversation.
4. As a user with specific layout preferences, I want to toggle individual
   segments via a `/statusbar` command, so that I can customize the statusline
   to my screen budget.

## Acceptance Criteria

```gherkin
Feature: Pi Statusbar Telemetry and Branch Display

  Background:
    Given a Pi session is running with the statusbar extension active

  Scenario: Display CWD on main branch
    Given the current working directory is a Git repository on the "main" branch
    When the statusbar footer renders
    Then the directory segment displays "~/path" without a branch annotation

  Scenario: Display CWD with branch name on non-main branch
    Given the CWD is a Git repository on branch "feat/auth"
    When the statusbar footer renders
    Then the directory segment displays "~/path (feat/auth)"

  Scenario: Display CWD outside a Git repository
    Given the current working directory is not a Git repository
    When the statusbar footer renders
    Then the directory segment displays "~/path" without a branch annotation

  Scenario: Middle truncate directory and branch when width is constrained
    Given the terminal width budget for directory is 20 columns
    And the CWD with branch is "~/code/long-project (feature-xyz)"
    When the statusbar footer renders
    Then the directory segment is truncated with "…" to fit 20 columns

  Scenario: Render model and effort segment
    Given an active model "gemini-3.7-flash" with thinking effort "high"
    When the statusbar footer renders
    Then the model segment displays "gemini-3.7-flash high"

  Scenario: Render context usage percentage and limit
    Given a context window limit of 1048576 tokens and usage of 24117 tokens
    When the statusbar footer renders
    Then the context segment displays "2.3% of 1.0M used"

  Scenario: Render streaming token rate and time to first token
    Given a turn with TTFT of 2.75s and streaming rate of 255 TPS
    When the statusbar footer renders
    Then the token segment displays "TTFT 2.75s · 255 TPS"

  Scenario: Render session total cost
    Given total accrued cost across the current branch is $0.1061
    When the statusbar footer renders
    Then the cost segment displays "$0.1061"

  Scenario: Toggle segment visibility interactively
    When the user runs the command "/statusbar segments hide tokens"
    Then the tokens segment is excluded from the rendered footer
    And the configuration is persisted across session restarts
```

## Testing Seams

Where this feature's behaviour is exercised:

- **Segment Formatter Boundary** — Unit tests for pure formatting functions
  (`formatCwd`, `formatCost`, `formatTokens`, `formatContext`,
  `formatModelName`) verifying string formatting, ANSI color boundaries, and
  truncation algorithms.
- **Git Branch Resolver** — Isolation seam for repository inspection and
  caching with mockable file system and command execution.
- **Pi Footer Component Lifecycle** — Integration tests verifying footer
  factory attachment, event subscriptions (`session_start`, `turn_start`,
  `turn_end`, `assistant_message`), and `/statusbar` command handlers.

## Implementation Decisions

- **Git Branch Resolution**: Resolve the active Git branch via non-blocking or
  cached Git execution with a short TTL cache, falling back silently when Git is
  absent or the CWD is not a Git repository.
- **Branch Visibility Rule**: Show the branch suffix `(<branch>)` if and only if
  the resolved branch name is non-empty and not equal to `main`.
- **Segment Ordering and Separators**: Default order matches the reference
  layout: `directory`, `model`, `context`, `tokens`, `cost`, separated by
  dimmed middle dots (` · `).
- **Width Budgeting Strategy**: Compute fixed-width segments first (model,
  context, tokens, cost, separators), then allocate all remaining available
  columns to the directory segment, applying middle truncation if needed.
- **Persistence**: Persist segment visibility preferences in JSON format in the
  user's agent configuration directory with environment variable overrides.

## Out of Scope

- Git status telemetry beyond branch name (uncommitted count, ahead/behind
  counts are excluded).
- Customizing colors or segment ordering via CLI (fixed standard palette and
  canonical segment order).
- Remote repository synchronization status.

## Research

- Reference implementation: `@odinlayer/pi-statusbar` v0.3.3 npm distribution.

## Open Questions

- None.
