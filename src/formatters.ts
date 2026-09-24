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

export function contextAnsiColor(percent: number): string {
  if (percent > 60) return "\x1b[38;2;255;80;80m"; // red
  if (percent > 40) return "\x1b[38;2;255;165;0m"; // orange
  return "\x1b[38;2;80;220;80m"; // green
}

export function costAnsiColor(cost: number, _ceiling = 0): string {
  if (cost >= 1.0) return "\x1b[38;2;255;80;80m"; // red (>= $1.00)
  if (cost >= 0.01) return "\x1b[38;2;255;165;0m"; // orange (cents)
  if (cost > 0.001) return "\x1b[38;2;255;215;0m"; // yellow (0.1¢ – 1¢)
  return "\x1b[38;2;80;220;80m"; // green (<= 0.1¢)
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
