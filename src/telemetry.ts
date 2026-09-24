import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type McpCounts = { servers: number; tools: number };

export function sessionCostFromBranch(branch: readonly unknown[]): number {
  let total = 0;
  for (const entry of branch) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (rec.type !== "message") continue;
    const message = rec.message as Record<string, unknown> | undefined;
    if (!message || message.role !== "assistant") continue;
    const usage = message.usage as { cost?: { total?: number } } | undefined;
    const cost = usage?.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost)) {
      total += cost;
    }
  }
  return total;
}

export function hslToRgb(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    g1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function ttftAnsiColor(seconds: number): string {
  if (seconds >= 5) return "\x1b[38;2;255;80;80m"; // red (worst)
  if (seconds >= 4) return "\x1b[38;2;255;110;180m"; // pink
  if (seconds >= 3) return "\x1b[38;2;255;165;0m"; // orange
  if (seconds >= 2) return "\x1b[38;2;255;215;0m"; // yellow
  return "\x1b[38;2;80;220;80m"; // green
}

export function tpsAnsiColor(rate: number, tokenCount: number): string {
  if (tokenCount <= rate) return "\x1b[38;2;140;140;140m"; // dim grey
  if (rate < 15) return "\x1b[38;2;255;80;80m"; // red (worst)
  if (rate < 30) return "\x1b[38;2;255;110;180m"; // pink
  if (rate < 45) return "\x1b[38;2;255;165;0m"; // orange
  if (rate < 60) return "\x1b[38;2;255;215;0m"; // yellow
  if (rate < 75) return "\x1b[38;2;80;180;255m"; // info blue
  return "\x1b[38;2;80;220;80m"; // green
}

export function tokenRateAnsiColor(rate: number, ceiling: number): string {
  const t = Math.max(0, Math.min(1, (Math.max(1, rate) - 1) / (ceiling - 1)));
  const hue = 120 * t; // 0 (red) → 120 (green)
  const { r, g, b } = hslToRgb(hue, 1, 0.55);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function normalizeEffortLevel(level: string): string {
  switch (level) {
    case "min":
      return "minimal";
    case "med":
      return "medium";
    case "xhigh":
    case "extra-high":
      return "xhigh";
    default:
      return level;
  }
}

export function extractMcpServerName(
  name: string,
  description?: string
): string | null {
  const viaMatch = description?.match(/\(via\s+(.+?)\s+MCP server\)/i);
  if (viaMatch?.[1]) return viaMatch[1].trim();

  if (!name.startsWith("mcp_")) return null;
  const rest = name.slice("mcp_".length);
  if (!rest) return null;
  const firstSep = rest.indexOf("_");
  if (firstSep <= 0) return null;
  return rest.slice(0, firstSep);
}

export function getMcpCounts(
  tools: ReturnType<ExtensionAPI["getAllTools"]>
): McpCounts | null {
  const mcpTools = tools.filter((tool) => tool.name.startsWith("mcp_"));
  if (mcpTools.length === 0) return null;

  const servers = new Set<string>();
  for (const tool of mcpTools) {
    const server = extractMcpServerName(tool.name, tool.description);
    if (server) servers.add(server);
  }

  return { servers: servers.size, tools: mcpTools.length };
}

export function formatMcpSummary(counts: McpCounts | null): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.servers > 0) parts.push(`MCP ${counts.servers}`);
  if (counts.tools > 0) parts.push(`Tools ${counts.tools}`);
  return parts.join(" · ");
}

export class TokenRateTracker {
  private _isStreaming = false;
  private _lastCompletedRate = 0;
  private _lastCompletedTokenCount = 0;
  private _lastTTFT: number | null = null;
  private _hasData = false;

  private _ttftSamples: number[] = [];
  private _tpsSamples: number[] = [];

  private _turnStartMs: number | null = null;
  private _callStartMs: number | null = null;
  private _firstDeltaMs: number | null = null;
  private _toolExecStartMs: number | null = null;
  private _totalPauseMs = 0;
  private _turnTokens = 0;
  private _destroyed = false;

  get ttft(): number | null {
    return this._lastTTFT;
  }

  get tps(): number {
    return this._lastCompletedRate;
  }

  liveTps(now: number = performance.now()): number {
    if (!this._isStreaming) return this._lastCompletedRate;
    if (this._firstDeltaMs == null) return this._lastCompletedRate || 0;
    const pauseMs =
      this._totalPauseMs +
      (this._toolExecStartMs != null ? now - this._toolExecStartMs : 0);
    const elapsed = Math.max(1, now - this._firstDeltaMs - pauseMs);
    const rate = this._turnTokens / (elapsed / 1000);
    if (rate === 0 && this._lastCompletedRate > 0)
      return this._lastCompletedRate;
    return rate;
  }

  liveTokenCount(): number {
    if (!this._isStreaming) return this._lastCompletedTokenCount;
    return Math.max(this._turnTokens, this._lastCompletedTokenCount);
  }

  get tokenCount(): number {
    return this._lastCompletedTokenCount;
  }

  get displayAvg(): number {
    return this._lastCompletedRate;
  }

  start(turnStartMs: number): void {
    if (this._destroyed) return;
    const wasStreaming = this._isStreaming;
    this._isStreaming = true;
    if (!wasStreaming) {
      this._turnStartMs = turnStartMs;
      this._callStartMs = turnStartMs;
      this._firstDeltaMs = null;
      this._toolExecStartMs = null;
      this._totalPauseMs = 0;
      this._turnTokens = 0;
      this._ttftSamples = [];
      this._tpsSamples = [];
    }
  }

  record(event: AssistantMessageEvent): void {
    if (
      event.type !== "text_delta" &&
      event.type !== "thinking_delta" &&
      event.type !== "toolcall_delta"
    )
      return;
    if (!this._isStreaming || this._turnStartMs == null)
      this.start(performance.now());

    const now = performance.now();

    if (this._firstDeltaMs == null && this._callStartMs != null) {
      this._firstDeltaMs = now;
      const callTTFT = (now - this._callStartMs) / 1000;
      this._ttftSamples.push(callTTFT);
      this._lastTTFT =
        this._ttftSamples.reduce((s, v) => s + v, 0) / this._ttftSamples.length;
    }

    if (event.partial.usage?.output) {
      this._turnTokens = event.partial.usage.output;
    }
  }

  pauseForTool(): void {
    if (!this._isStreaming) return;
    if (this._toolExecStartMs != null) return;
    this._toolExecStartMs = performance.now();
  }

  resumeAfterTool(): void {
    if (!this._isStreaming || this._toolExecStartMs == null) return;
    this._totalPauseMs += performance.now() - this._toolExecStartMs;
    this._toolExecStartMs = null;
    this._callStartMs = performance.now();
  }

  stop(turnEndMs: number, providerOutputTokens: number | null): void {
    if (this._toolExecStartMs != null) {
      this._totalPauseMs += turnEndMs - this._toolExecStartMs;
      this._toolExecStartMs = null;
    }
    if (this._firstDeltaMs == null) {
      this._turnTokens = 0;
      return;
    }

    const streamingSeconds = Math.max(
      0.001,
      (turnEndMs - this._firstDeltaMs - this._totalPauseMs) / 1000
    );

    const turnTokens =
      providerOutputTokens != null && providerOutputTokens > this._turnTokens
        ? providerOutputTokens
        : this._turnTokens;

    if (turnTokens > 0 && streamingSeconds > 0) {
      const callTps = turnTokens / streamingSeconds;
      this._tpsSamples.push(callTps);
      this._lastCompletedRate =
        this._tpsSamples.reduce((s, v) => s + v, 0) / this._tpsSamples.length;
      this._lastCompletedTokenCount = turnTokens;
      this._hasData = true;
    }

    this._firstDeltaMs = null;
    this._totalPauseMs = 0;
    this._turnTokens = 0;
    this._callStartMs = performance.now();
  }

  cancel(): void {
    this._isStreaming = false;
    this._turnStartMs = null;
    this._callStartMs = null;
    this._firstDeltaMs = null;
    this._toolExecStartMs = null;
    this._totalPauseMs = 0;
    this._turnTokens = 0;
  }

  reset(): void {
    this._lastCompletedRate = 0;
    this._lastCompletedTokenCount = 0;
    this._lastTTFT = null;
    this._hasData = false;
    this._ttftSamples = [];
    this._tpsSamples = [];
    this.cancel();
  }

  destroy(): void {
    this._destroyed = true;
    this._isStreaming = false;
  }

  snapshot(): {
    lastCompletedRate: number;
    lastCompletedTokenCount: number;
    lastTTFT: number | null;
    hasData: boolean;
  } {
    return {
      lastCompletedRate: this._lastCompletedRate,
      lastCompletedTokenCount: this._lastCompletedTokenCount,
      lastTTFT: this._lastTTFT,
      hasData: this._hasData,
    };
  }

  restore(snapshot?: {
    lastCompletedRate?: number;
    currentAvgRate?: number;
    lastCompletedTokenCount?: number;
    lastTTFT?: number | null;
    hasData?: boolean;
  }): void {
    const rate = snapshot?.lastCompletedRate ?? snapshot?.currentAvgRate;
    if (typeof rate === "number" && Number.isFinite(rate))
      this._lastCompletedRate = rate;
    if (typeof snapshot?.lastCompletedTokenCount === "number") {
      this._lastCompletedTokenCount = snapshot.lastCompletedTokenCount;
    } else if (typeof rate === "number" && rate > 0) {
      this._lastCompletedTokenCount = rate + 1;
    }
    if (typeof snapshot?.hasData === "boolean")
      this._hasData = snapshot.hasData;
  }
}
