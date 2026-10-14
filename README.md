# pi-statusbar

A custom statusline / footer extension for the [pi coding agent](https://github.com/earendil-works/pi) providing real-time telemetry, model context, streaming throughput, session cost, and automatic Git branch tracking.

## Features

- **Active Directory & Git Branch:** Shows CWD (`~/path`), and automatically displays active Git branch in parentheses (`~/path (<branch>)`) when working on any branch other than `main`.
- **Model & Effort Level:** Shows selected physical settings, or separates a
  virtual selection from the last observed physical response.
- **Context Window Utilization:** Real-time context usage percentage and total capacity (`X.X% of X.XM used`).
- **Live Streaming Metrics:** Measures Time-To-First-Token (TTFT) and throughput rate (Tokens Per Second - TPS), excluding tool call execution pauses.
- **Session Expenditure:** Live session cost calculation summed across current branch messages.
- **MCP Server & Tool Counts:** Right-aligned MCP integration overview.
- **Extension Statuses:** Shows status text from other extensions without
  recognizing their keys or requiring a router package.
- **Interactive Configuration:** Customize visible segments via `/statusbar` CLI or interactive TUI modal.
- **Flicker-Free Transitions:** Sticky footer patching during session resets and reloads.

## Status Bar Layout

```text
claude-3-7-sonnet high · ~/code/my-repo (feat/login) · 4.2% of 1.0M used · TTFT 0.42s · 85 TPS · $0.0412
```

When on `main` or in a non-git directory:

```text
claude-3-7-sonnet high · ~/code/my-repo · 4.2% of 1.0M used · TTFT 0.42s · 85 TPS · $0.0412
```

## Segments

| Segment     | Description                                                                | Example                                |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `directory` | Working directory with `~` home contraction and Git branch when not `main` | `~/code/pi-statusbar (feat/telemetry)` |
| `model`     | Selected physical settings or last observed virtual dispatch               | `claude-3-7-sonnet high`               |
| `context`   | Context window usage percentage and size                                   | `3.1% of 1.0M used`                    |
| `tokens`    | Time to first token (TTFT) and tokens per second (TPS)                     | `TTFT 0.35s · 72 TPS`                  |
| `cost`      | Accrued session cost from current branch messages                          | `$0.0820`                              |

## Physical and Virtual Models

A physical selection keeps the existing model, effort and optional icon display,
even when its name is `auto`. The selected physical model and selected effort
always take priority over older response metadata.

With a native virtual selection, the model segment distinguishes selection from
observation:

```text
selected auto low; physical pending/unknown
selected auto low; last observed gpt-a high
selected auto low; last observed claude-b xhigh
selected auto low; last observed claude-b effort unknown
```

The last observed model, effort and icon come from the same successful assistant
response on the active branch and a matching physical catalog entry. Responses
ending in error or abort do not replace successful evidence. Missing catalog entries
leave the physical pair unknown; historical messages without effort metadata
show `effort unknown`, never the virtual selection's effort.

Tree navigation and session restoration refresh this branch-local observation,
context usage and branch cost. An observation describes a past response, not the
next route, and does not change the selected model or effort.

Other extensions' status text appears after the configured segments. It updates
without model events and is truncated to the available terminal width. With no
statuses, the existing physical and MCP layout is unchanged.

The proposal preview is tested with physical sessions on Pi 0.84.2 and 1.2.0,
and with synthetic native virtual sessions on Pi 1.2.0. No Auto extension is
loaded by these tests. This is not a package-install or future-host guarantee.

## Commands

Configure statusbar segments directly from within Pi:

- `/statusbar` or `/statusbar config`: Open the interactive TUI segment configurator.
- `/statusbar list`: Display currently enabled segments.
- `/statusbar segments all`: Enable all statusbar segments.
- `/statusbar segments none`: Hide all statusbar segments.
- `/statusbar segments only <seg1> <seg2>`: Enable only specified segments.
- `/statusbar segments show <segment>`: Enable a specific segment.
- `/statusbar segments hide <segment>`: Hide a specific segment.

## Environment Variables

- `PI_STATUSBAR_SHOW`: Comma-separated list of segments to display (e.g. `directory,model,cost`).
- `PI_STATUSBAR_CONFIG`: Custom file path for persisting segment settings (defaults to `~/.pi/agent/pi-statusbar.json`).

## Makefile Targets

```bash
make test    # Run test suite with Vitest
make lint    # Typecheck TypeScript sources with tsc --noEmit
make try     # Test extension in a live Pi session
make install # Install npm dependencies
```

## License

MIT
