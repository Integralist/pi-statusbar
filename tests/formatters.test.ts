import { describe, it, expect } from "vitest";
import {
  formatCost,
  formatTokens,
  middleTruncate,
  formatCwd,
  formatModelName,
  contextAnsiColor,
  costAnsiColor,
  stripAnsi,
} from "../src/formatters.js";

describe("formatCost", () => {
  it("formats 0 and negative costs as $0", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(-5)).toBe("$0");
    expect(formatCost(Number.NaN)).toBe("$0");
  });

  it("formats costs >= $1 with 2 decimals", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.2345)).toBe("$1.23");
    expect(formatCost(12.5)).toBe("$12.50");
  });

  it("formats costs between $0.0001 and $1 with 4 decimals", () => {
    expect(formatCost(0.1061)).toBe("$0.1061");
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

describe("contextAnsiColor", () => {
  it("returns empty string for <= 75%", () => {
    expect(contextAnsiColor(50)).toBe("");
    expect(contextAnsiColor(75)).toBe("");
  });

  it("returns yellow for 75% < percent <= 85%", () => {
    expect(contextAnsiColor(76)).toBe("\x1b[38;2;255;215;0m");
    expect(contextAnsiColor(85)).toBe("\x1b[38;2;255;215;0m");
  });

  it("returns orange for 85% < percent <= 95%", () => {
    expect(contextAnsiColor(86)).toBe("\x1b[38;2;255;165;0m");
    expect(contextAnsiColor(95)).toBe("\x1b[38;2;255;165;0m");
  });

  it("returns red for > 95%", () => {
    expect(contextAnsiColor(96)).toBe("\x1b[38;2;255;80;80m");
    expect(contextAnsiColor(100)).toBe("\x1b[38;2;255;80;80m");
  });
});

describe("costAnsiColor", () => {
  it("returns red ANSI color code", () => {
    expect(costAnsiColor(0.5)).toBe("\x1b[38;2;255;80;80m");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape sequences", () => {
    const colored = "\x1b[38;2;255;80;80m$0.1234\x1b[0m";
    expect(stripAnsi(colored)).toBe("$0.1234");
  });
});
