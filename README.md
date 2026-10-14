# pi-statusbar

A custom statusline / footer extension for the [pi coding agent](https://github.com/earendil-works/pi) providing real-time telemetry, model context, streaming throughput, session cost, and automatic Git branch tracking.

## Features

- **Active Directory & Git Branch:** Shows CWD (`~/path`), and automatically displays active Git branch in parentheses (`~/path (<branch>)`) when working on any branch other than `main`.
- **Model & Effort Level:** Displays the selected model and thinking level, or
  the auto-selected physical model and thinking level when using a virtual
  model.
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
| `model`     | Active (or auto-selected) model and normalized thinking effort             | `claude-3-7-sonnet high`               |
| `context`   | Context window usage percentage and size                                   | `3.1% of 1.0M used`                    |
| `tokens`    | Time to first token (TTFT) and tokens per second (TPS)                     | `TTFT 0.35s · 72 TPS`                  |
| `cost`      | Accrued session cost from current branch messages                          | `$0.0820`                              |

## Physical and Virtual Models

A physical selection displays the selected model, effort, and optional icon.
When a virtual model (`api: "pi-virtual"`, such as `auto`) is selected, the
`model` segment shows the auto-selected physical model, effort, and icon from
the latest successful assistant response on the active branch (or falls back to
the selected virtual model before the first response).

Responses ending in error or abort do not replace the last successful response,
and tree navigation or session restoration refreshes the branch-local model,
context usage, and branch cost.

Other extensions' status text appears after the configured segments.

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
