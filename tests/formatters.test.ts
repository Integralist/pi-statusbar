import { describe, it, expect } from "vitest";
import {
  formatCost,
  formatTokens,
  middleTruncate,
  formatCwd,
  formatModelName,
  getModelIcon,
  contextAnsiColor,
  costAnsiColor,
  uncachedInputAnsiColor,
  cacheHitAnsiColor,
  outputTokensAnsiColor,
  formatContextUsage,
  formatTurnIo,
  stripAnsi,
} from "../src/formatters.js";

describe("formatCost", () => {
  it("formats 0 and negative costs as $0", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(-5)).toBe("$0");
    expect(formatCost(Number.NaN)).toBe("$0");
  });

  it("formats costs >= $0.01 with 2 decimals", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.2345)).toBe("$1.23");
    expect(formatCost(12.5)).toBe("$12.50");
    expect(formatCost(0.3626)).toBe("$0.36");
    expect(formatCost(0.1061)).toBe("$0.11");
    expect(formatCost(0.01)).toBe("$0.01");
  });

  it("formats sub-cent costs between $0.0001 and $0.01 with 4 decimals", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("formats sub-penny costs (< $0.0001) with 5 decimals", () => {
    expect(formatCost(0.00005)).toBe("$0.00005");
    expect(formatCost(0.00001)).toBe("$0.00001");
  });
});

describe("formatTokens", () => {
  it("formats small token counts as plain numbers", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands as k", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(9_900)).toBe("9.9k");
    expect(formatTokens(10_000)).toBe("10k");
    expect(formatTokens(500_000)).toBe("500k");
  });

  it("formats millions as M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_048_576)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(10_000_000)).toBe("10M");
  });
});

describe("middleTruncate", () => {
  it("returns truncated slice if width <= 1", () => {
    expect(middleTruncate("hello", 0)).toBe("");
    expect(middleTruncate("hello", 1)).toBe("h");
  });

  it("returns string intact if length <= width", () => {
    expect(middleTruncate("short", 10)).toBe("short");
    expect(middleTruncate("exact", 5)).toBe("exact");
  });

  it("truncates middle with ellipsis if length > width", () => {
    expect(middleTruncate("abcdefghij", 5)).toBe("ab…ij");
    expect(middleTruncate("123456789", 6)).toBe("123…89");
  });
});

describe("formatCwd", () => {
  const home = "/Users/testuser";

  it("replaces home directory with ~", () => {
    expect(formatCwd("/Users/testuser/code/project", home, null, 100)).toBe(
      "~/code/project"
    );
    expect(formatCwd("/Users/testuser", home, null, 100)).toBe("~");
  });

  it("leaves paths outside home directory intact", () => {
    expect(formatCwd("/etc/nginx", home, null, 100)).toBe("/etc/nginx");
    expect(formatCwd("/", home, null, 100)).toBe("/");
  });

  it("suppresses branch suffix when branch is 'main' or null", () => {
    expect(formatCwd("/Users/testuser/code/project", home, "main", 100)).toBe(
      "~/code/project"
    );
    expect(formatCwd("/Users/testuser/code/project", home, null, 100)).toBe(
      "~/code/project"
    );
  });

  it("appends branch suffix when branch is not 'main'", () => {
    expect(formatCwd("/Users/testuser/code/project", home, "feat/auth", 100)).toBe(
      "~/code/project (feat/auth)"
    );
    expect(formatCwd("/Users/testuser/code/project", home, "fix-123", 100)).toBe(
      "~/code/project (fix-123)"
    );
  });

  it("middle-truncates when total display string exceeds maxWidth", () => {
    const formatted = formatCwd(
      "/Users/testuser/code/long-project-name",
      home,
      "feature-branch-name",
      25
    );
    // Display is "~/code/long-project-name (feature-branch-name)" (45 chars)
    // Truncated to 25 chars with middle ellipsis
    expect(formatted.length).toBe(25);
    expect(formatted).toContain("…");
    expect(formatted.startsWith("~/code/")).toBe(true);
    expect(formatted.endsWith("name)")).toBe(true);
  });

  it("handles empty or 0 maxWidth", () => {
    expect(formatCwd("/Users/testuser", home, "feat", 0)).toBe("");
    expect(formatCwd("/Users/testuser", home, "feat", -1)).toBe("");
  });
});

describe("formatModelName", () => {
  it("returns 'no-model' when id is undefined or empty", () => {
    expect(formatModelName(undefined)).toBe("no-model");
    expect(formatModelName("")).toBe("no-model");
  });

  it("strips provider prefix", () => {
    expect(formatModelName("anthropic/claude-3-7-sonnet")).toBe(
      "claude-3-7-sonnet"
    );
  });

  it("strips date suffixes", () => {
    expect(formatModelName("claude-3-5-sonnet-20241022")).toBe(
      "claude-3-5-sonnet"
    );
    expect(formatModelName("gpt-4o-2024-08-06")).toBe("gpt-4o");
  });
});

describe("getModelIcon", () => {
  it("returns empty string when id is undefined or empty", () => {
    expect(getModelIcon(undefined)).toBe("");
    expect(getModelIcon("")).toBe("");
  });

  it("returns Claude icon for claude and anthropic models", () => {
    expect(getModelIcon("claude-3-5-sonnet-20241022")).toBe("\uec82");
    expect(getModelIcon("anthropic/claude-3-7-sonnet")).toBe("\uec82");
    expect(getModelIcon("amazon-bedrock/global.anthropic.claude-opus-5-5")).toBe(
      "\uec82"
    );
  });

  it("returns Copilot icon for GPT, o1/o3, and OpenAI models", () => {
    expect(getModelIcon("gpt-4o")).toBe("\uf4b8");
    expect(getModelIcon("openai/gpt-4.5-preview")).toBe("\uf4b8");
    expect(getModelIcon("o1-mini")).toBe("\uf4b8");
    expect(getModelIcon("o3-mini")).toBe("\uf4b8");
    expect(getModelIcon("chatgpt-4o-latest")).toBe("\uf4b8");
  });

  it("returns Google icon for Gemini and Google models", () => {
    expect(getModelIcon("gemini-1.5-pro")).toBe("\uf1a0");
    expect(getModelIcon("google/gemini-2.0-flash")).toBe("\uf1a0");
  });

  it("returns default robot icon for other models", () => {
    expect(getModelIcon("deepseek-reasoner")).toBe("\udb81\udea9");
    expect(getModelIcon("mistral-large")).toBe("\udb81\udea9");
  });
});

describe("contextAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;80;220;80m"],
    [4.7, "\x1b[38;2;80;220;80m"],
    [19.9999, "\x1b[38;2;80;220;80m"],
    [20, "\x1b[38;2;255;215;0m"],
    [20.0001, "\x1b[38;2;255;215;0m"],
    [39.9999, "\x1b[38;2;255;215;0m"],
    [40, "\x1b[38;2;255;165;0m"],
    [40.0001, "\x1b[38;2;255;165;0m"],
    [49.9999, "\x1b[38;2;255;165;0m"],
    [50, "\x1b[38;2;255;80;80m"],
    [50.0001, "\x1b[38;2;255;80;80m"],
    [100, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for %s percent used", (percent, color) => {
    expect(contextAnsiColor(percent)).toBe(color);
  });
});

describe("costAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;80;220;80m"],
    [0.01, "\x1b[38;2;80;220;80m"],
    [0.9999, "\x1b[38;2;80;220;80m"],
    [1, "\x1b[38;2;80;220;80m"],
    [1.0001, "\x1b[38;2;255;215;0m"],
    [4.9999, "\x1b[38;2;255;215;0m"],
    [5, "\x1b[38;2;255;215;0m"],
    [5.0001, "\x1b[38;2;255;165;0m"],
    [9.9999, "\x1b[38;2;255;165;0m"],
    [10, "\x1b[38;2;255;165;0m"],
    [10.0001, "\x1b[38;2;255;80;80m"],
    [19.9999, "\x1b[38;2;255;80;80m"],
    [20, "\x1b[38;2;255;80;80m"],
    [20.0001, "\x1b[38;2;255;80;80m"],
    [100, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for cost %s USD", (cost, color) => {
    expect(costAnsiColor(cost)).toBe(color);
  });
});

describe("uncachedInputAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;80;220;80m"],
    [19999, "\x1b[38;2;80;220;80m"],
    [20000, "\x1b[38;2;255;215;0m"],
    [49999, "\x1b[38;2;255;215;0m"],
    [50000, "\x1b[38;2;255;165;0m"],
    [99999, "\x1b[38;2;255;165;0m"],
    [100000, "\x1b[38;2;255;80;80m"],
    [250000, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for %s uncached input tokens", (tokens, color) => {
    expect(uncachedInputAnsiColor(tokens)).toBe(color);
  });
});

describe("cacheHitAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;255;80;80m"],
    [19.9, "\x1b[38;2;255;80;80m"],
    [20, "\x1b[38;2;255;165;0m"],
    [49.9, "\x1b[38;2;255;165;0m"],
    [50, "\x1b[38;2;255;215;0m"],
    [74.9, "\x1b[38;2;255;215;0m"],
    [75, "\x1b[38;2;80;220;80m"],
    [100, "\x1b[38;2;80;220;80m"],
  ])("returns the expected color for %s percent cache hit", (percent, color) => {
    expect(cacheHitAnsiColor(percent)).toBe(color);
  });
});

describe("outputTokensAnsiColor", () => {
  it.each([
    [0, "\x1b[38;2;80;220;80m"],
    [3999, "\x1b[38;2;80;220;80m"],
    [4000, "\x1b[38;2;255;215;0m"],
    [9999, "\x1b[38;2;255;215;0m"],
    [10000, "\x1b[38;2;255;165;0m"],
    [19999, "\x1b[38;2;255;165;0m"],
    [20000, "\x1b[38;2;255;80;80m"],
    [50000, "\x1b[38;2;255;80;80m"],
  ])("returns the expected color for %s output tokens", (tokens, color) => {
    expect(outputTokensAnsiColor(tokens)).toBe(color);
  });
});

describe("formatContextUsage", () => {
  it("formats percent with tokens and context window when tokens are known", () => {
    const formatted = formatContextUsage({
      tokens: 9100,
      contextWindow: 200000,
      percent: 4.55,
    });
    expect(stripAnsi(formatted)).toBe("4.5% (9.1k / 200k)");
    expect(formatted).toBe("\x1b[38;2;80;220;80m4.5% (9.1k / 200k)\x1b[0m");
  });

  it("falls back to percent of window used when tokens is null or omitted", () => {
    expect(
      stripAnsi(formatContextUsage({ tokens: null, contextWindow: 200000, percent: 25 }))
    ).toBe("25.0% of 200k used");
    expect(
      stripAnsi(formatContextUsage({ contextWindow: 1048576, percent: 2.3 }))
    ).toBe("2.3% of 1.0M used");
  });

  it("renders placeholders when percent or usage is missing", () => {
    expect(
      formatContextUsage({ tokens: null, contextWindow: 200000, percent: null })
    ).toBe("— of 200k used");
    expect(formatContextUsage(undefined)).toBe("—");
  });
});

describe("formatTurnIo", () => {
  it("renders uncolored placeholders when usage is null or zero", () => {
    expect(formatTurnIo(null)).toBe("↑— ↓—");
    expect(
      formatTurnIo({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 })
    ).toBe("↑— ↓—");
  });

  it("formats input, cache hit percentage, and output with separate threshold colors", () => {
    const formatted = formatTurnIo({
      inputTokens: 17000,
      cacheReadTokens: 11730,
      outputTokens: 564,
      isFirstTurn: false,
    });
    expect(stripAnsi(formatted)).toBe("↑17k (69% cached) ↓564");
    expect(formatted).toBe(
      "\x1b[38;2;80;220;80m↑17k\x1b[0m \x1b[38;2;255;215;0m(69% cached)\x1b[0m \x1b[38;2;80;220;80m↓564\x1b[0m"
    );
  });

  it("renders (0% cached) uncolored on the first turn when cache is cold", () => {
    const coldFirstTurn = formatTurnIo({
      inputTokens: 16000,
      cacheReadTokens: 0,
      outputTokens: 171,
      isFirstTurn: true,
    });
    expect(stripAnsi(coldFirstTurn)).toBe("↑16k (0% cached) ↓171");
    expect(coldFirstTurn).toBe(
      "\x1b[38;2;80;220;80m↑16k\x1b[0m (0% cached) \x1b[38;2;80;220;80m↓171\x1b[0m"
    );

    const warmTurnMiss = formatTurnIo({
      inputTokens: 16000,
      cacheReadTokens: 0,
      outputTokens: 171,
      isFirstTurn: false,
    });
    expect(warmTurnMiss).toBe(
      "\x1b[38;2;80;220;80m↑16k\x1b[0m \x1b[38;2;255;80;80m(0% cached)\x1b[0m \x1b[38;2;80;220;80m↓171\x1b[0m"
    );
  });

  it("handles output-only usage when input tokens are 0", () => {
    const formatted = formatTurnIo({
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 4500,
    });
    expect(stripAnsi(formatted)).toBe("↑— ↓4.5k");
    expect(formatted).toBe("↑— \x1b[38;2;255;215;0m↓4.5k\x1b[0m");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape sequences", () => {
    const colored = "\x1b[38;2;255;80;80m$0.1234\x1b[0m";
    expect(stripAnsi(colored)).toBe("$0.1234");
  });
});
