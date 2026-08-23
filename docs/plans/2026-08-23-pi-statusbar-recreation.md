# Pi Statusbar Extension Recreation & Non-Main Branch Display

- **Status**: Planning
- **Author**: Integralist
- **Created**: 2026-08-23
- **Language**: TypeScript

## Summary

Recreate the `@odinlayer/pi-statusbar` extension from scratch in this repository
with an enhanced directory segment that displays the active Git branch name in
parentheses (`~/path (<branch_name>)`) when working on any branch other than
`main`. The status bar preserves the exact layout, colors, and live telemetry of
the original (model & effort, context percentage/limit, TTFT & TPS rate, session
cost, MCP summaries, and `/statusbar` settings management) while adding robust,
cached Git branch resolution.

## Specification

Acceptance criteria and scope:
[Pi Statusbar Extension — Specification](../specifications/2026-08-23-pi-statusbar.md).

## Research

- Reference implementation: `@odinlayer/pi-statusbar` v0.3.3 npm package
  (examined at `~/.pi/agent/npm/node_modules/@odinlayer/pi-statusbar/`).
- Visual baseline: Reference screenshot showing the 5 left-aligned segments and
  exact segment color scheme.

## Prerequisites & Dependencies

- Node.js 20+ runtime
- `@earendil-works/pi-coding-agent` (peer dependency for Extension API)
- `@earendil-works/pi-tui` (peer dependency for TUI components & truncation)
- `@earendil-works/pi-ai` (peer dependency for assistant message types)
- `tsx` and `vitest` (or Node test runner) for unit and integration testing

## Pull Request Delivery

- **Mode:** Single PR

| Layer | Base   | Includes  | Branch |
| ----- | ------ | --------- | ------ |
| 1     | `main` | Slices 1–3| `main` |

## Implementation

### Slice 1: Pure Formatters, Truncation & Git Branch Resolver

- **Blocked by**: None — can start immediately
- **Delivers**: Testable core formatting utilities for CWD with branch
  annotation, model names, context window sizing, TTFT/TPS metrics, cost
  calculations, and cached Git branch detection.
- **Consumes**: None
- **Produces**:
  - `getGitBranch(cwd: string): string | null`
  - `formatCwd(cwd: string, home: string, branch: string | null, max: number): string`
  - `middleTruncate(s: string, width: number): string`
  - `formatModelName(id: string | undefined): string`
  - `formatTokens(tokens: number): string`
  - `formatCost(cost: number): string`
  - `contextAnsiColor(pct: number): string`
  - `costAnsiColor(cost: number, ceiling: number): string`

- [x] **Task 1.1**: Initialize project scaffolding (`package.json`,
  `tsconfig.json`, `Makefile`, `vitest.config.ts`).

  ```json
  {
    "name": "pi-statusbar",
    "version": "0.1.0",
    "type": "module",
    "scripts": {
      "test": "vitest run",
      "lint": "tsc --noEmit"
    },
    "peerDependencies": {
      "@earendil-works/pi-coding-agent": "*",
      "@earendil-works/pi-tui": "*",
      "@earendil-works/pi-ai": "*"
    }
  }
  ```

- [x] **Task 1.2**: Implement `getGitBranch` with a TTL cache to avoid blocking
  the event loop on rapid re-renders.

  ```typescript
  import { execFileSync } from "node:child_process";

  interface BranchCacheEntry {
    branch: string | null;
    expiresAt: number;
  }

  const branchCache = new Map<string, BranchCacheEntry>();
  const BRANCH_CACHE_TTL_MS = 2000;

  export function getGitBranch(cwd: string): string | null {
    const now = Date.now();
    const cached = branchCache.get(cwd);
    if (cached && cached.expiresAt > now) {
      return cached.branch;
    }

    let branch: string | null = null;
    try {
      const output = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 500,
        encoding: "utf8",
      }).trim();
      branch = output.length > 0 ? output : null;
    } catch {
      branch = null;
    }

    branchCache.set(cwd, { branch, expiresAt: now + BRANCH_CACHE_TTL_MS });
    return branch;
  }
  ```

- [x] **Task 1.3**: Implement `formatCwd` combining home-directory contraction,
  branch suffix (only when `branch !== null && branch !== "main"`), and
  middle-truncation.

  ```typescript
  export function formatCwd(
    cwd: string,
    homeDir: string,
    branch: string | null,
    maxWidth: number
  ): string {
    let display = cwd;
    if (homeDir && (cwd === homeDir || cwd.startsWith(homeDir + "/"))) {
      display = "~" + cwd.slice(homeDir.length);
    }
    if (branch && branch !== "main") {
      display = `${display} (${branch})`;
    }
    if (display === "/") return "/";
    if (maxWidth <= 0) return "";
    if (display.length <= maxWidth) return display;
    return middleTruncate(display, maxWidth);
  }

  export function middleTruncate(s: string, width: number): string {
    if (width <= 1) return s.slice(0, Math.max(0, width));
    if (s.length <= width) return s;
    const keep = width - 1;
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return s.slice(0, head) + "…" + s.slice(s.length - tail);
  }
  ```

- [x] **Task 1.4**: Author comprehensive unit tests covering standard branch,
  main branch, non-git directory, truncation with branch, and cost/token
  formatters.

### Slice 2: Statusbar UI Component & Telemetry Engine

- **Blocked by**: Slice 1 (formatters and Git branch resolver)
- **Delivers**: Custom statusbar extension component registering with Pi's
  `setExtensionFooter`, listening to assistant streaming events, measuring TTFT
  and TPS, walking branch history for session costs, dynamic width allocation,
  and rendering the 5 left-aligned segments with right-aligned MCP counts.
- **Consumes**: Formatters and `getGitBranch` from Slice 1.
- **Produces**: `default export function initStatusBar(api: ExtensionAPI): void`

- [ ] **Task 2.1**: Implement streaming telemetry collector tracking turn start
  timestamp, first token timestamp (for TTFT), token delta counts, and live TPS.

  ```typescript
  interface TurnMetrics {
    turnStartTime: number | null;
    firstTokenTime: number | null;
    tokenCount: number;
    lastCompletedRate: number | null;
    lastTTFT: number | null;
    isStreaming: boolean;
  }
  ```

- [ ] **Task 2.2**: Implement session cost calculator walking branch entries
  (`ctx.sessionManager.getBranch()`) to sum `usage.cost.total`.

- [ ] **Task 2.3**: Implement dynamic layout width budgeting: compute width of
  fixed segments (`model`, `context`, `tokens`, `cost`) and middle dots,
  allocating all remaining columns to `directory` (formatted with branch).

  ```typescript
  const dirBudget = Math.max(8, leftBudget - nonDirWidth - sepTotal);
  const branch = getGitBranch(ctx.cwd);
  segmentTexts.directory = `\x1b[38;2;255;165;0m${formatCwd(
    ctx.cwd,
    homedir(),
    branch,
    dirBudget
  )}\x1b[0m`;
  ```

- [ ] **Task 2.4**: Implement session transition keep-alive and sticky footer
  patching to prevent visual flicker during session reload or creation.

### Slice 3: Segment Configurator, Interactive `/statusbar` Command & Settings

- **Blocked by**: Slice 2 (UI component and telemetry engine)
- **Delivers**: Full CLI and interactive TUI management of statusbar segments
  via `/statusbar`, persistent storage in `~/.pi/agent/pi-statusbar.json`, and
  environment variable override support.
- **Consumes**: Extension registration lifecycle and segment state from Slice 2.
- **Produces**: Fully functional `/statusbar` command handler and configuration
  loader.

- [ ] **Task 3.1**: Implement config loader/saver reading `PI_STATUSBAR_SHOW`,
  `PI_STATUSBAR_CONFIG`, and persisting chosen segments to disk.

  ```typescript
  export type SegmentName =
    | "directory"
    | "model"
    | "context"
    | "tokens"
    | "cost";

  export function loadConfig(): { segments: SegmentName[] } {
    if (process.env.PI_STATUSBAR_SHOW) {
      const parts = process.env.PI_STATUSBAR_SHOW
        .split(",")
        .map((s) => s.trim()) as SegmentName[];
      return { segments: parts.filter(isSegmentName) };
    }
    // Read from ~/.pi/agent/pi-statusbar.json with fallback to default
  }
  ```

- [ ] **Task 3.2**: Implement `/statusbar` CLI subcommand parser supporting
  `segments list`, `segments all`, `segments none`, `segments only <...>`,
  `segments show <name>`, `segments hide <name>`.

- [ ] **Task 3.3**: Implement interactive TUI segment selector dialog using
  `SettingsList` from `@earendil-works/pi-tui`.

### Documentation

- [ ] Write `README.md` documenting installation via `pi install`, segment
  descriptions, branch display behavior, `/statusbar` commands, and
  configuration variables.
- [ ] Document Makefile targets (`make test`, `make build`, `make deploy`).

### Verification

- [ ] Run `make test` verifying all unit tests pass with 100% coverage on
  branch formatting, truncation, and telemetry computations.
- [ ] Test in live Pi session under `main` branch: confirm footer shows
  `~/path` without branch.
- [ ] Test in live Pi session under non-main branch (e.g. `feat/test`): confirm
  footer shows `~/path (feat/test)`.
- [ ] Test narrowing terminal window: confirm middle-truncation applies cleanly
  to `~/path (feat/test)`.
- [ ] Run `/statusbar segments hide model` and confirm model is hidden and
  setting persists.

## File Changes

| File                         | Change                                              |
| ---------------------------- | --------------------------------------------------- |
| `package.json`               | Package definition, metadata, and pi extension entry|
| `tsconfig.json`              | TypeScript configuration                            |
| `Makefile`                   | Test, lint, format, and deploy targets              |
| `vitest.config.ts`           | Vitest test configuration                           |
| `src/git.ts`                 | Git branch resolution with TTL cache                |
| `src/formatters.ts`          | Pure string, ANSI, and CWD/branch formatters        |
| `src/config.ts`              | Config loader, saver, and environment resolver      |
| `extensions/pi-statusbar.ts` | Main Pi extension entry point and footer component  |
| `tests/formatters.test.ts`   | Unit tests for formatting and branch display        |
| `tests/git.test.ts`          | Unit tests for Git branch detection and caching     |
| `README.md`                  | Project overview, features, commands, and options   |

## Parallel Execution

> [!IMPORTANT]
> Only delegate a slice to a fire-and-forget subagent if it is
> independent, well-specified, touches files no other slice touches,
> and won't need interactive steering. A sealed subagent can't be
> redirected mid-flight — it ploughs ahead while objections pile up.
> Work you expect to iterate on belongs in the main thread or a
> chat-able teammate. For editing work that still benefits from
> parallel scanning, prefer a two-phase split: a read-only subagent
> returns a proposed-change list, then the main thread applies edits
> with the user able to veto each one.

The implementation is an inherently sequential 3-slice pipeline (formatters →
engine → configuration CLI). All slices will be executed sequentially in the
main thread.

## Notes & Caveats

- **Branch Resolution Performance:** Synchronous `git symbolic-ref` execution is
  cached with a 2-second TTL to ensure zero render stutter during 60 Hz or 1 Hz
  UI re-paints.
- **Detached HEAD & Non-Git Directories:** When HEAD is detached or outside a
  Git directory, `getGitBranch` returns `null`, and `formatCwd` seamlessly falls
  back to plain directory display.
- **Trunk Branch Identification:** Standard trunk branch name is `main`. If on
  `main`, the branch suffix is suppressed to keep trunk workspace paths minimal.
