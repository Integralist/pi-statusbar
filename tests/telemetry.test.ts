import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sessionCostFromBranch,
  turnTokenUsageFromBranch,
  TokenRateTracker,
  ttftAnsiColor,
  tpsAnsiColor,
  normalizeEffortLevel,
  getMcpCounts,
  formatMcpSummary,
} from "../src/telemetry.js";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

describe("sessionCostFromBranch", () => {
  it("returns 0 for empty branch", () => {
    expect(sessionCostFromBranch([])).toBe(0);
  });

  it("ignores non-assistant entries or missing cost info", () => {
    const branch = [
      { type: "session_start" },
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "message", message: { role: "assistant", usage: {} } },
      null,
      undefined,
      "invalid",
    ];
    expect(sessionCostFromBranch(branch as readonly unknown[])).toBe(0);
  });

  it("sums usage.cost.total across assistant messages", () => {
    const branch = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { cost: { total: 0.0512 } },
        },
      },
      {
        type: "message",
        message: {
          role: "user",
          content: "next",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { cost: { total: 0.0549 } },
        },
      },
    ];
    expect(sessionCostFromBranch(branch)).toBeCloseTo(0.1061, 4);
  });
});

describe("turnTokenUsageFromBranch", () => {
  it("returns null when branch has no assistant token usage", () => {
    expect(turnTokenUsageFromBranch([])).toBeNull();
    expect(
      turnTokenUsageFromBranch([
        { type: "message", message: { role: "user", content: "hello" } },
        { type: "message", message: { role: "assistant", usage: { cost: { total: 0.05 } } } },
      ])
    ).toBeNull();
  });

  it("extracts latest prompt input/cache and sums output across the current turn", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "first prompt" } },
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: { input: 9000, cacheRead: 0, cacheWrite: 0, output: 300 },
        },
      },
      { type: "message", message: { role: "user", content: "second prompt" } },
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          usage: { input: 200, cacheRead: 8800, cacheWrite: 100, output: 120 },
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: { input: 300, cacheRead: 8900, cacheWrite: 0, output: 300 },
        },
      },
    ];

    expect(turnTokenUsageFromBranch(branch)).toEqual({
      inputTokens: 9200,
      cacheReadTokens: 8900,
      outputTokens: 420,
      isFirstTurn: false,
    });
  });

  it("marks the first prompt turn or first turn after a model change as isFirstTurn", () => {
    const firstTurnBranch = [
      { type: "message", message: { role: "user", content: "hello" } },
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: { input: 16000, cacheRead: 0, cacheWrite: 0, output: 171 },
        },
      },
    ];
    expect(turnTokenUsageFromBranch(firstTurnBranch)).toEqual({
      inputTokens: 16000,
      cacheReadTokens: 0,
      outputTokens: 171,
      isFirstTurn: true,
    });

    const afterModelSwitchBranch = [
      ...firstTurnBranch,
      { type: "model_change", provider: "google", modelId: "gemini-3.0-flash" },
      { type: "message", message: { role: "user", content: "next" } },
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: { input: 17000, cacheRead: 0, cacheWrite: 0, output: 200 },
        },
      },
    ];
    expect(turnTokenUsageFromBranch(afterModelSwitchBranch)).toEqual({
      inputTokens: 17000,
      cacheReadTokens: 0,
      outputTokens: 200,
      isFirstTurn: true,
    });
  });

  it("includes an unpersisted latest assistant message from message_end without double-counting", () => {
    const persistedMsg = {
      role: "assistant",
      stopReason: "toolUse",
      usage: { input: 100, cacheRead: 8000, cacheWrite: 0, output: 100 },
    };
    const unpersistedMsg = {
      role: "assistant",
      stopReason: "stop",
      usage: { input: 200, cacheRead: 8900, cacheWrite: 0, output: 320 },
    };
    const branch = [
      { type: "message", message: { role: "user", content: "prompt" } },
      { type: "message", message: persistedMsg },
    ];

    expect(turnTokenUsageFromBranch(branch, unpersistedMsg)).toEqual({
      inputTokens: 9100,
      cacheReadTokens: 8900,
      outputTokens: 420,
      isFirstTurn: true,
    });

    // When already persisted in branch, does not double-count
    expect(
      turnTokenUsageFromBranch(
        [...branch, { type: "message", message: unpersistedMsg }],
        unpersistedMsg
      )
    ).toEqual({
      inputTokens: 9100,
      cacheReadTokens: 8900,
      outputTokens: 420,
      isFirstTurn: true,
    });
  });
});

describe("TokenRateTracker", () => {
  let tracker: TokenRateTracker;

  beforeEach(() => {
    tracker = new TokenRateTracker();
    vi.restoreAllMocks();
  });

  it("starts with zeroed metrics", () => {
    expect(tracker.ttft).toBeNull();
    expect(tracker.tps).toBe(0);
    expect(tracker.tokenCount).toBe(0);
    expect(tracker.liveTps()).toBe(0);
  });

  it("computes TTFT on first delta and TPS on stop", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    tracker.start(now); // start at t=1000

    now = 1500; // first delta at t=1500 (500ms TTFT)
    const delta1: AssistantMessageEvent = {
      type: "text_delta",
      contentIndex: 0,
      delta: "Hello",
      partial: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: { input: 10, output: 5, totalTokens: 15 },
      },
    } as unknown as AssistantMessageEvent;
    tracker.record(delta1);

    expect(tracker.ttft).toBeCloseTo(0.5, 2);

    now = 2500; // 1000ms streaming time from first delta (1500 to 2500)
    tracker.stop(now, 100); // 100 tokens in 1.0s = 100 TPS

    expect(tracker.tps).toBeCloseTo(100, 1);
    expect(tracker.tokenCount).toBe(100);
  });

  it("excludes tool execution pauses from TPS calculation", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    tracker.start(now);

    now = 1200; // first delta (TTFT = 200ms)
    tracker.record({
      type: "text_delta",
      contentIndex: 0,
      delta: "calling tool",
      partial: {
        role: "assistant",
        content: [],
        usage: { output: 10 },
      },
    } as unknown as AssistantMessageEvent);

    now = 1400; // start tool
    tracker.pauseForTool();

    now = 3400; // tool takes 2000ms
    tracker.resumeAfterTool();

    now = 4200; // stop turn (total time 1200->4200 = 3000ms minus 2000ms tool = 1000ms streaming)
    tracker.stop(now, 50); // 50 tokens in 1s = 50 TPS

    expect(tracker.tps).toBeCloseTo(50, 1);
  });

  it("handles snapshots and restores correctly", () => {
    tracker.restore({
      lastCompletedRate: 75.5,
      lastCompletedTokenCount: 150,
      hasData: true,
    });

    expect(tracker.tps).toBeCloseTo(75.5, 1);
    expect(tracker.tokenCount).toBe(150);

    const snapshot = tracker.snapshot();
    expect(snapshot.lastCompletedRate).toBeCloseTo(75.5, 1);
    expect(snapshot.lastCompletedTokenCount).toBe(150);
    expect(snapshot.hasData).toBe(true);
  });

  it("resets metrics cleanly", () => {
    tracker.restore({
      lastCompletedRate: 100,
      lastCompletedTokenCount: 200,
      hasData: true,
    });
    tracker.reset();

    expect(tracker.tps).toBe(0);
    expect(tracker.tokenCount).toBe(0);
    expect(tracker.ttft).toBeNull();
    expect(tracker.snapshot().hasData).toBe(false);
  });
});

describe("ttftAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;80;220;80m"],
    [0.5, "\x1b[38;2;80;220;80m"],
    [1.9999, "\x1b[38;2;80;220;80m"],
    [2, "\x1b[38;2;255;215;0m"],
    [2.0001, "\x1b[38;2;255;215;0m"],
    [2.9999, "\x1b[38;2;255;215;0m"],
    [3, "\x1b[38;2;255;165;0m"],
    [3.0001, "\x1b[38;2;255;165;0m"],
    [4, "\x1b[38;2;255;165;0m"],
    [4.9999, "\x1b[38;2;255;165;0m"],
    [5, "\x1b[38;2;255;80;80m"],
    [5.0001, "\x1b[38;2;255;80;80m"],
    [100, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for %s seconds TTFT", (seconds, color) => {
    expect(ttftAnsiColor(seconds)).toBe(color);
  });
});

describe("tpsAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;255;80;80m"],
    [14.9999, "\x1b[38;2;255;80;80m"],
    [15, "\x1b[38;2;255;165;0m"],
    [15.0001, "\x1b[38;2;255;165;0m"],
    [29.9999, "\x1b[38;2;255;165;0m"],
    [30, "\x1b[38;2;255;215;0m"],
    [30.0001, "\x1b[38;2;255;215;0m"],
    [59.9999, "\x1b[38;2;255;215;0m"],
    [60, "\x1b[38;2;80;220;80m"],
    [60.0001, "\x1b[38;2;80;220;80m"],
    [75, "\x1b[38;2;80;220;80m"],
    [10000, "\x1b[38;2;80;220;80m"],
    [50, "\x1b[38;2;255;215;0m"],
    [100, "\x1b[38;2;80;220;80m"],
    [10, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for %s TPS", (rate, color) => {
    expect(tpsAnsiColor(rate)).toBe(color);
  });
});

describe("normalizeEffortLevel", () => {
  it("normalizes short aliases", () => {
    expect(normalizeEffortLevel("min")).toBe("minimal");
    expect(normalizeEffortLevel("med")).toBe("medium");
    expect(normalizeEffortLevel("extra-high")).toBe("xhigh");
    expect(normalizeEffortLevel("high")).toBe("high");
    expect(normalizeEffortLevel("low")).toBe("low");
  });
});

describe("MCP summaries", () => {
  it("returns null for tools without mcp prefix", () => {
    const tools = [
      { name: "read", description: "Read file" },
      { name: "write", description: "Write file" },
    ];
    expect(getMcpCounts(tools as any)).toBeNull();
  });

  it("extracts server count and tool count", () => {
    const tools = [
      { name: "mcp_github_create_pr", description: "Create PR (via github MCP server)" },
      { name: "mcp_github_get_issue", description: "Get issue (via github MCP server)" },
      { name: "mcp_slack_post_msg", description: "Post to slack (via slack MCP server)" },
    ];
    const counts = getMcpCounts(tools as any);
    expect(counts).toEqual({ servers: 2, tools: 3 });
    expect(formatMcpSummary(counts)).toBe("MCP 2 · Tools 3");
  });
});
