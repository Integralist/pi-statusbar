import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SegmentName = "directory" | "model" | "context" | "tokens" | "cost";

export type GlobalBarConfig = {
  segments?: SegmentName[];
};

export const DEFAULT_SEGMENTS: SegmentName[] = [
  "directory",
  "model",
  "context",
  "tokens",
  "cost",
];

export const ALL_SEGMENTS: readonly SegmentName[] = [
  "directory",
  "model",
  "context",
  "tokens",
  "cost",
];

export const SEGMENT_LABELS: Record<SegmentName, string> = {
  directory: "CWD",
  model: "Model & effort",
  context: "Context usage",
  tokens: "Tokens/s",
  cost: "Cost",
};

export function getConfigPath(): string {
  return (
    process.env.PI_STATUSBAR_CONFIG ??
    join(homedir(), ".pi", "agent", "pi-statusbar.json")
  );
}

export function isSegmentName(value: string): value is SegmentName {
  return (ALL_SEGMENTS as readonly string[]).includes(value as SegmentName);
}

export function parseSegments(
  raw: string | undefined = process.env.PI_STATUSBAR_SHOW
): SegmentName[] {
  if (!raw) return DEFAULT_SEGMENTS;

  const requested = raw
    .split(",")
    .map((segment) => segment.trim().toLowerCase())
    .filter(isSegmentName);

  return requested.length > 0 ? requested : DEFAULT_SEGMENTS;
}

export function serializeSegments(
  segments: readonly SegmentName[]
): SegmentName[] {
  return ALL_SEGMENTS.filter((segment) => segments.includes(segment));
}

export function parseSerializedSegments(value: unknown): SegmentName[] | null {
  if (!Array.isArray(value)) return null;
  const segments = value.filter(
    (segment): segment is SegmentName =>
      typeof segment === "string" && isSegmentName(segment)
  );
  return serializeSegments(segments);
}

export function splitSegmentNames(raw: string): SegmentName[] {
  return raw
    .split(/[\s,]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(isSegmentName);
}

export function describeSegments(segments: readonly SegmentName[]): string {
  if (segments.length === 0) return "showing none";
  return `showing: ${segments.map((segment) => SEGMENT_LABELS[segment]).join(", ")}`;
}

export function readGlobalConfig(
  configPath: string = getConfigPath()
): GlobalBarConfig {
  try {
    const data = JSON.parse(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    return {
      segments: parseSerializedSegments(data.segments) ?? undefined,
    };
  } catch {
    return {};
  }
}

export function readGlobalSegments(
  configPath: string = getConfigPath(),
  envShow?: string
): SegmentName[] {
  const envVal = envShow ?? process.env.PI_STATUSBAR_SHOW;
  if (envVal) {
    return parseSegments(envVal);
  }
  const fromConfig = readGlobalConfig(configPath).segments ?? null;
  if (fromConfig) {
    return Array.from(new Set([...DEFAULT_SEGMENTS, ...fromConfig]));
  }
  return DEFAULT_SEGMENTS;
}

export function writeGlobalConfig(
  config: GlobalBarConfig,
  configPath: string = getConfigPath()
): void {
  const data = JSON.stringify(config, null, 2);
  mkdirSync(dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${data}\n`, "utf8");
  renameSync(tmpPath, configPath);
}

export function writeGlobalSegments(
  segments: readonly SegmentName[],
  configPath: string = getConfigPath()
): void {
  const existing = readGlobalConfig(configPath);
  writeGlobalConfig(
    { ...existing, segments: serializeSegments(segments) },
    configPath
  );
}
