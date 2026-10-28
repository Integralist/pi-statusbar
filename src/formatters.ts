export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd >= 0.0001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(5)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000;
    return value >= 10 ? `${Math.round(value)}M` : `${value.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const value = n / 1_000;
    return value >= 10 ? `${Math.round(value)}k` : `${value.toFixed(1)}k`;
  }
  return `${n}`;
}

export function middleTruncate(s: string, width: number): string {
  if (width <= 1) return s.slice(0, Math.max(0, width));
  if (s.length <= width) return s;
  const keep = width - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

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

export function formatModelName(id: string | undefined): string {
  if (!id) return "no-model";
  const base = id.includes("/") ? (id.split("/").pop() ?? id) : id;
  return base.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export function getModelIcon(id: string | undefined): string {
  if (!id) return "";
  const lower = id.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return "\uec82"; // nf-cod-claude
  }
  if (
    lower.includes("gpt") ||
    lower.includes("openai") ||
    lower.includes("chatgpt") ||
    /(^|[-_/])o[134]([-_/]|$)/.test(lower)
  ) {
    return "\uf4b8"; // nf-oct-copilot
  }
  if (lower.includes("gemini") || lower.includes("google")) {
    return "\uf1a0"; // nf-fa-google
  }
  return "\udb81\udea9"; // nf-md-robot
}

export function contextAnsiColor(percent: number): string {
  if (percent >= 50) return "\x1b[38;2;255;80;80m"; // red
  if (percent >= 40) return "\x1b[38;2;255;165;0m"; // orange
  if (percent >= 20) return "\x1b[38;2;255;215;0m"; // yellow
  return "\x1b[38;2;80;220;80m"; // green
}

export function costAnsiColor(cost: number, _ceiling = 0): string {
  if (cost > 10) return "\x1b[38;2;255;80;80m"; // red (> $10, including above $20)
  if (cost > 5) return "\x1b[38;2;255;165;0m"; // orange (> $5, <= $10)
  if (cost > 1) return "\x1b[38;2;255;215;0m"; // yellow (> $1, <= $5)
  return "\x1b[38;2;80;220;80m"; // green (<= $1)
}

export function uncachedInputAnsiColor(tokens: number): string {
  if (tokens >= 100_000) return "\x1b[38;2;255;80;80m"; // red
  if (tokens >= 50_000) return "\x1b[38;2;255;165;0m"; // orange
  if (tokens >= 20_000) return "\x1b[38;2;255;215;0m"; // yellow
  return "\x1b[38;2;80;220;80m"; // green
}

export function cacheHitAnsiColor(percent: number): string {
  if (percent >= 75) return "\x1b[38;2;80;220;80m"; // green
  if (percent >= 50) return "\x1b[38;2;255;215;0m"; // yellow
  if (percent >= 20) return "\x1b[38;2;255;165;0m"; // orange
  return "\x1b[38;2;255;80;80m"; // red
}

export function outputTokensAnsiColor(tokens: number): string {
  if (tokens >= 20_000) return "\x1b[38;2;255;80;80m"; // red
  if (tokens >= 10_000) return "\x1b[38;2;255;165;0m"; // orange
  if (tokens >= 4_000) return "\x1b[38;2;255;215;0m"; // yellow
  return "\x1b[38;2;80;220;80m"; // green
}

export function formatContextUsage(
  usage:
    | {
        tokens?: number | null;
        contextWindow: number;
        percent: number | null;
      }
    | undefined
): string {
  if (!usage) return "—";
  const window = formatTokens(usage.contextWindow);
  if (usage.percent === null) {
    return `— of ${window} used`;
  }
  const pct = `${usage.percent.toFixed(1)}%`;
  const color = contextAnsiColor(usage.percent);
  const text =
    typeof usage.tokens === "number" && Number.isFinite(usage.tokens)
      ? `${pct} (${formatTokens(usage.tokens)} / ${window})`
      : `${pct} of ${window} used`;
  return color ? `${color}${text}\x1b[0m` : text;
}

export function formatTurnIo(
  usage: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    isFirstTurn?: boolean;
  } | null
): string {
  if (!usage || (usage.inputTokens <= 0 && usage.outputTokens <= 0)) {
    return "↑— ↓—";
  }

  let inPart = "↑—";
  if (usage.inputTokens > 0) {
    const cacheRead = Math.max(0, usage.cacheReadTokens);
    const uncachedInput = Math.max(0, usage.inputTokens - cacheRead);
    const cachePct = Math.round((cacheRead / usage.inputTokens) * 100);
    const inputText = `${uncachedInputAnsiColor(uncachedInput)}↑${formatTokens(usage.inputTokens)}\x1b[0m`;
    const cacheLabel = `(${cachePct}% cached)`;
    const cacheText =
      usage.isFirstTurn && cachePct === 0
        ? cacheLabel
        : `${cacheHitAnsiColor(cachePct)}${cacheLabel}\x1b[0m`;
    inPart = `${inputText} ${cacheText}`;
  }

  const outText = `↓${formatTokens(Math.max(0, usage.outputTokens))}`;
  const outPart = `${outputTokensAnsiColor(usage.outputTokens)}${outText}\x1b[0m`;

  return `${inPart} ${outPart}`;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
