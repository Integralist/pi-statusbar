import { homedir } from "node:os";
import {
  getSettingsListTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { getGitBranch } from "../src/git.js";
import {
  formatCost,
  formatTokens,
  formatCwd,
  formatModelName,
  getModelIcon,
  contextAnsiColor,
  costAnsiColor,
} from "../src/formatters.js";
import {
  sessionCostFromBranch,
  TokenRateTracker,
  ttftAnsiColor,
  tpsAnsiColor,
  normalizeEffortLevel,
  getMcpCounts,
  formatMcpSummary,
} from "../src/telemetry.js";
import {
  type SegmentName,
  ALL_SEGMENTS,
  SEGMENT_LABELS,
  isSegmentName,
  serializeSegments,
  splitSegmentNames,
  describeSegments,
  readGlobalSegments,
  writeGlobalSegments,
  readGlobalNerdFonts,
  writeGlobalNerdFonts,
  parseBoolean,
} from "../src/config.js";

const SEGMENT_SEPARATOR = "·";
const STICKY_FOOTER_MARKER = "__piStatusbarStickyFooter";
const STICKY_FOOTER_KEEPALIVE = "__piStatusbarKeepAlive";
const INTERACTIVE_MODE_PATH =
  "/usr/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";

let stickyFooterPatchApplied = false;
let stickyFooterPatchInFlight = false;
let lastStickyFooterLine = "";

export function applyStickyFooterTransitionPatch(): void {
  if (stickyFooterPatchApplied || stickyFooterPatchInFlight) return;
  stickyFooterPatchInFlight = true;

  void import(INTERACTIVE_MODE_PATH)
    .then((module) => {
      const record = module as Record<string, unknown>;
      const InteractiveMode = record.InteractiveMode as
        | { prototype?: Record<string, unknown> }
        | undefined;
      const proto = InteractiveMode?.prototype as
        | (Record<string, unknown> & {
            resetExtensionUI?: (...args: unknown[]) => void;
            setExtensionFooter?: (factory?: unknown) => void;
            [key: string]: unknown;
          })
        | undefined;
      if (!proto) return;

      if (
        proto.__piStatusbarPatchedResetExtensionUI &&
        proto.__piStatusbarPatchedSetExtensionFooter
      ) {
        stickyFooterPatchApplied = true;
        return;
      }

      const originalReset = proto.resetExtensionUI;
      const originalSetExtensionFooter = proto.setExtensionFooter;
      if (
        typeof originalReset !== "function" ||
        typeof originalSetExtensionFooter !== "function"
      )
        return;

      if (!proto.__piStatusbarPatchedSetExtensionFooter) {
        proto.setExtensionFooter = function patchedSetExtensionFooter(
          this: Record<string, unknown>,
          factory?: unknown
        ) {
          const currentCustomFooter = this.customFooter as
            | Record<string, unknown>
            | undefined;
          const hasStickyFooter = Boolean(
            currentCustomFooter &&
              currentCustomFooter[STICKY_FOOTER_MARKER] === true
          );

          if (!factory && hasStickyFooter) {
            const ui = this.ui as
              | {
                  addChild?: (child: unknown) => void;
                  removeChild?: (child: unknown) => void;
                  requestRender?: () => void;
                  terminal?: { columns?: number };
                }
              | undefined;
            const width = ui?.terminal?.columns ?? 80;
            try {
              const render = currentCustomFooter?.render as
                | ((w: number) => string[])
                | undefined;
              const rendered = render?.(width)?.[0];
              if (rendered) lastStickyFooterLine = rendered;
            } catch {
              // Use the last remembered footer line.
            }

            const frozenFooter = {
              [STICKY_FOOTER_MARKER]: true,
              dispose() {},
              invalidate() {},
              render(w: number): string[] {
                return [truncateToWidth(lastStickyFooterLine, w)];
              },
            };

            try {
              if (ui?.removeChild && currentCustomFooter) {
                ui.removeChild(currentCustomFooter);
              }
              this.customFooter = frozenFooter;
              ui?.addChild?.(frozenFooter);
              ui?.requestRender?.();
            } catch {
              ui?.requestRender?.();
            }
            return;
          }

          originalSetExtensionFooter.call(this, factory);
        };
        proto.__piStatusbarPatchedSetExtensionFooter = true;
      }

      if (!proto.__piStatusbarPatchedResetExtensionUI) {
        proto.resetExtensionUI = function patchedResetExtensionUI(
          this: Record<string, unknown>,
          ...args: unknown[]
        ) {
          this.__piStatusbarDuringReset = true;
          try {
            originalReset.apply(this, args);
          } finally {
            this.__piStatusbarDuringReset = false;
          }
        };
        proto.__piStatusbarPatchedResetExtensionUI = true;
      }

      stickyFooterPatchApplied = true;
    })
    .catch(() => {
      // Best-effort patch; if path/layout differs we simply skip it.
    })
    .finally(() => {
      stickyFooterPatchInFlight = false;
    });
}

const FOOTER_REPAINT_MS = 1000;

type ResponseObservation = {
  role: "assistant";
  stopReason: string;
  provider?: string;
  model?: string;
  thinkingLevel?: unknown;
};

function isSuccessfulResponse(message: unknown): message is ResponseObservation {
  if (!message || typeof message !== "object") return false;
  const response = message as ResponseObservation;
  return (
    response.role === "assistant" &&
    ["stop", "length", "toolUse"].includes(response.stopReason)
  );
}

function observedPhysicalPair(
  message: ResponseObservation | undefined,
  ctx: ExtensionContext
) {
  if (
    typeof message?.provider !== "string" ||
    typeof message.model !== "string"
  ) return;
  const model = ctx.modelRegistry?.find?.(message.provider, message.model);
  if (!model || String(model.api) === "pi-virtual") return;
  const effort =
    typeof message.thinkingLevel === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      message.thinkingLevel
    )
      ? message.thinkingLevel
      : undefined;
  return { model, effort };
}

export default function initStatusBar(pi: ExtensionAPI): void {
  applyStickyFooterTransitionPatch();

  let requestRender: (() => void) | undefined;
  let lastPaintedAt = 0;
  let needsRecompute = true;
  let cachedLine: string | null = null;
  let cachedWidth = -1;
  let cachedMcpSummary = "";
  let cachedStatuses = "";
  let lastResponse: ResponseObservation | undefined;
  let mcpSummaryText = "";
  let visibleSegments: SegmentName[] = readGlobalSegments();
  let nerdFontsEnabled = readGlobalNerdFonts();

  const refresh = (force = false) => {
    if (!requestRender) return;
    if (!force && performance.now() - lastPaintedAt < FOOTER_REPAINT_MS) return;
    lastPaintedAt = performance.now();
    needsRecompute = true;
    requestRender();
  };
  const tracker = new TokenRateTracker();

  const rebuildObservation = (ctx: ExtensionContext) => {
    lastResponse = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && isSuccessfulResponse(entry.message)) {
        lastResponse = entry.message;
      }
    }
  };

  const displayedModel = (ctx: ExtensionContext) => {
    const selected = ctx.model;
    const selectedEffort = normalizeEffortLevel(String(pi.getThinkingLevel()));
    if (String(selected?.api) !== "pi-virtual") {
      return { model: selected, effort: selectedEffort };
    }
    const observed = observedPhysicalPair(lastResponse, ctx);
    if (observed) {
      return { model: observed.model, effort: observed.effort ?? selectedEffort };
    }
    return { model: selected, effort: selectedEffort };
  };

  const updateMcpSummary = () => {
    try {
      mcpSummaryText = formatMcpSummary(getMcpCounts(pi.getAllTools()));
    } catch {
      // Handle during teardown/rehydration
    }
  };

  const setVisibleSegments = (segments: readonly SegmentName[]) => {
    visibleSegments = serializeSegments(segments);
    writeGlobalSegments(visibleSegments);
    refresh(true);
  };

  const setNerdFontsEnabled = (enabled: boolean) => {
    nerdFontsEnabled = enabled;
    writeGlobalNerdFonts(enabled);
    refresh(true);
  };

  const openSegmentConfigurator = async (ctx: ExtensionContext) => {
    await ctx.ui.custom((tui, theme, _kb, done) => {
      const segmentVisibility = new Map(
        ALL_SEGMENTS.map((segment): [SegmentName, boolean] => [
          segment,
          visibleSegments.includes(segment),
        ])
      );
      const persistSegmentsFromVisibility = () => {
        setVisibleSegments(
          ALL_SEGMENTS.filter((segment) => segmentVisibility.get(segment))
        );
      };

      const segmentItems: SettingItem[] = [
        ...ALL_SEGMENTS.map(
          (segment): SettingItem => ({
            id: `segment:${segment}`,
            label: SEGMENT_LABELS[segment],
            description: "Footer segment visibility",
            currentValue: segmentVisibility.get(segment) ? "shown" : "hidden",
            values: ["shown", "hidden"],
          })
        ),
        {
          id: "option:nerdfonts",
          label: "Nerd Font icons",
          description: "Show model glyph next to LLM name",
          currentValue: nerdFontsEnabled ? "enabled" : "disabled",
          values: ["enabled", "disabled"],
        },
      ];

      const container = new Container();
      container.addChild(
        new (class {
          render(_width: number) {
            return [
              theme.fg("accent", theme.bold("pi-statusbar visibility")),
              theme.fg(
                "dim",
                "Footer segments · Enter/Space toggles · Esc closes"
              ),
              "",
            ];
          }
          invalidate() {}
        })()
      );

      const settingsList = new SettingsList(
        segmentItems,
        Math.min(segmentItems.length + 2, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          if (id.startsWith("segment:")) {
            const segment = id.slice("segment:".length);
            if (!isSegmentName(segment)) return;
            segmentVisibility.set(segment, newValue === "shown");
            persistSegmentsFromVisibility();
          } else if (id === "option:nerdfonts") {
            setNerdFontsEnabled(newValue === "enabled");
          }
        },
        () => done(undefined),
        { enableSearch: true }
      );

      container.addChild(settingsList);

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
      };
    });
  };

  pi.registerCommand("statusbar", {
    description: "Configure pi-statusbar footer visibility",
    handler: async (args, ctx) => {
      const [section, action, ...rest] = args
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (
        !section ||
        section === "config" ||
        section === "configure" ||
        section === "edit"
      ) {
        await openSegmentConfigurator(ctx);
        return;
      }
      if (section === "list" || section === "ls") {
        ctx.ui.notify(
          `pi-statusbar footer: ${describeSegments(visibleSegments)}`,
          "info"
        );
        return;
      }

      if (
        section === "nerdfonts" ||
        section === "nerdfont" ||
        section === "icons"
      ) {
        if (!action || action === "status") {
          ctx.ui.notify(
            `pi-statusbar Nerd Fonts: ${nerdFontsEnabled ? "enabled" : "disabled"}`,
            "info"
          );
          return;
        }
        if (action === "toggle") {
          setNerdFontsEnabled(!nerdFontsEnabled);
        } else {
          const parsed = parseBoolean(action);
          if (parsed === undefined) {
            ctx.ui.notify(
              "Usage: /statusbar nerdfonts [on|off|toggle|status]",
              "warning"
            );
            return;
          }
          setNerdFontsEnabled(parsed);
        }
        ctx.ui.notify(
          `pi-statusbar Nerd Fonts: ${nerdFontsEnabled ? "enabled" : "disabled"}`,
          "info"
        );
        return;
      }

      if (
        section === "segment" ||
        section === "segments" ||
        section === "footer"
      ) {
        const segments = splitSegmentNames(rest.join(" "));
        if (
          (action === "only" || action === "show" || action === "hide") &&
          segments.length === 0
        ) {
          ctx.ui.notify(`Segments: ${ALL_SEGMENTS.join(", ")}`, "warning");
          return;
        }

        switch (action) {
          case undefined:
          case "config":
          case "configure":
          case "edit":
            await openSegmentConfigurator(ctx);
            return;
          case "list":
          case "ls":
            ctx.ui.notify(
              `pi-statusbar footer: ${describeSegments(visibleSegments)}`,
              "info"
            );
            return;
          case "all":
            setVisibleSegments(ALL_SEGMENTS);
            break;
          case "none":
            setVisibleSegments([]);
            break;
          case "only":
            setVisibleSegments(segments);
            break;
          case "hide":
            setVisibleSegments(
              visibleSegments.filter((segment) => !segments.includes(segment))
            );
            break;
          case "show":
            setVisibleSegments([...visibleSegments, ...segments]);
            break;
          default:
            ctx.ui.notify(
              "Usage: /statusbar [config] or /statusbar segments [list|all|none|only <segments>|show <segments>|hide <segments>]",
              "warning"
            );
            return;
        }

        ctx.ui.notify(
          `pi-statusbar footer: ${describeSegments(visibleSegments)}`,
          "info"
        );
        return;
      }

      ctx.ui.notify(
        "Usage: /statusbar [config] or /statusbar segments [list|all|none|only <segments>|show <segments>|hide <segments>]",
        "warning"
      );
    },
  });

  pi.on("model_select", async (_event, ctx) => {
    rebuildObservation(ctx);
    tracker.reset();
    refresh(true);
  });
  pi.on("thinking_level_select", async () => refresh(true));
  pi.on("turn_start", async () => {
    if (visibleSegments.includes("tokens")) tracker.start(performance.now());
  });
  pi.on("turn_end", async () => {
    tracker.cancel();
    refresh(true);
  });
  pi.on("tool_execution_start", async () => {
    if (visibleSegments.includes("tokens")) tracker.pauseForTool();
  });
  pi.on("tool_execution_end", async () => {
    if (visibleSegments.includes("tokens")) tracker.resumeAfterTool();
  });
  pi.on("message_update", async (event) => {
    if (visibleSegments.includes("tokens"))
      tracker.record(event.assistantMessageEvent);
    refresh();
  });
  pi.on("message_end", async (event) => {
    // The SDK emits message_end before appending the finalized message to history.
    if (isSuccessfulResponse(event.message)) lastResponse = event.message;
    if (
      visibleSegments.includes("tokens") &&
      event.message?.role === "assistant"
    ) {
      const providerOutput = event.message.usage?.output ?? null;
      tracker.stop(performance.now(), providerOutput);
    }
    refresh(true);
  });
  pi.on("session_before_tree", async () => {
    tracker.cancel();
  });
  pi.on("session_tree", async (_event, ctx) => {
    rebuildObservation(ctx);
    refresh(true);
  });

  pi.on("session_start", async (_event, ctx) => {
    rebuildObservation(ctx);
    tracker.reset();
    cachedLine = null;
    cachedWidth = -1;
    needsRecompute = true;
    visibleSegments = readGlobalSegments();
    nerdFontsEnabled = readGlobalNerdFonts();
    updateMcpSummary();

    if (ctx.hasUI) {
      ctx.ui.setFooter((tui, theme, footerData) => {
        requestRender = () => {
          tui.requestRender();
        };

        return {
          [STICKY_FOOTER_MARKER]: true,
          dispose() {
            if (
              (this as unknown as Record<string, unknown>)[
                STICKY_FOOTER_KEEPALIVE
              ] === true
            ) {
              return;
            }
            requestRender = undefined;
            cachedLine = null;
            cachedWidth = -1;
          },
          invalidate() {
            cachedLine = null;
            needsRecompute = true;
          },
          render(width: number): string[] {
            try {
              const mcpSummary = mcpSummaryText;
              const statuses = [
                ...(footerData?.getExtensionStatuses?.().values() ?? []),
              ]
                .map((text) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
                .filter(Boolean)
                .join(" · ");

              if (
                !needsRecompute &&
                width === cachedWidth &&
                cachedLine !== null &&
                mcpSummary === cachedMcpSummary &&
                statuses === cachedStatuses
              ) {
                return [truncateToWidth(cachedLine, width)];
              }
              needsRecompute = false;
              cachedWidth = width;
              cachedMcpSummary = mcpSummary;
              cachedStatuses = statuses;
              const mcpSummaryWidth = visibleWidth(mcpSummary);
              const leftWidthBudget =
                mcpSummaryWidth > 0
                  ? Math.max(0, width - mcpSummaryWidth - 1)
                  : width;

              const pair = displayedModel(ctx);
              const modelName = formatModelName(pair.model?.id);
              const effortLevel = pair.effort;
              const usage = ctx.getContextUsage();

              let contextSegmentText: string;
              if (usage && usage.percent !== null) {
                const pct = `${usage.percent.toFixed(1)}%`;
                const window = formatTokens(usage.contextWindow);
                const color = contextAnsiColor(usage.percent);
                const text = `${pct} of ${window} used`;
                contextSegmentText = color ? `${color}${text}\x1b[0m` : text;
              } else if (usage) {
                const window = formatTokens(usage.contextWindow);
                contextSegmentText = `— of ${window} used`;
              } else {
                contextSegmentText = "—";
              }

              const displayRate = tracker.liveTps();
              const RATE_DISPLAY_CAP = 9999;
              const displayRounded = Math.min(
                RATE_DISPLAY_CAP,
                Math.round(displayRate)
              );
              const displayLabel =
                displayRate > RATE_DISPLAY_CAP
                  ? `${RATE_DISPLAY_CAP}+`
                  : `${displayRounded}`;

              const ttft = tracker.ttft;
              const ttftStr =
                ttft == null
                  ? "—"
                  : ttft >= 100
                    ? `${Math.round(ttft)}s`
                    : `${ttft.toFixed(2)}s`;
              const ttftPart =
                ttft != null
                  ? `${ttftAnsiColor(ttft)}TTFT ${ttftStr}\x1b[0m`
                  : `TTFT ${ttftStr}`;

              const tpsPart =
                displayRate > 0
                  ? `${tpsAnsiColor(displayRate)}${displayLabel} TPS\x1b[0m`
                  : "— TPS";

              const tokenSegmentText =
                `${ttftPart}` +
                ` \x1b[38;2;140;140;140m·\x1b[0m` +
                ` ${tpsPart}`;

              const sessionCost = sessionCostFromBranch(
                ctx.sessionManager.getBranch()
              );
              const costGradientCeiling = 1.0;
              const costSegmentText = `${costAnsiColor(sessionCost, costGradientCeiling)}${formatCost(sessionCost)}\x1b[0m`;

              const modelIcon = nerdFontsEnabled
                ? getModelIcon(pair.model?.id)
                : "";
              const modelPrefix = modelIcon ? `${modelIcon} ` : "";
              const modelText = `${modelPrefix}${modelName} ${effortLevel}`;

              const separator = ` ${theme.fg("muted", SEGMENT_SEPARATOR)} `;
              const separatorWidth = 3; // " · "

              const segmentTexts: Record<SegmentName, string | null> = {
                directory: null,
                model: modelText,
                context: contextSegmentText,
                tokens: tokenSegmentText,
                cost: costSegmentText,
              };

              const visibleNonDirCount = visibleSegments.filter(
                (segment) => segment !== "directory"
              ).length;
              const separatorTotal =
                visibleNonDirCount > 0
                  ? (visibleNonDirCount +
                      (visibleSegments.includes("directory") ? 1 : 0) -
                      1) *
                    separatorWidth
                  : 0;
              const nonDirWidth = visibleSegments
                .filter((segment) => segment !== "directory")
                .reduce(
                  (sum, segment) =>
                    sum + visibleWidth(segmentTexts[segment] ?? ""),
                  0
                );
              const directoryMaxWidth = Math.max(
                8,
                leftWidthBudget - nonDirWidth - separatorTotal
              );

              const branch = getGitBranch(ctx.cwd);
              segmentTexts.directory = formatCwd(
                ctx.cwd,
                homedir(),
                branch,
                directoryMaxWidth
              );

              const segmentLine = visibleSegments
                .map((segment) => segmentTexts[segment])
                .filter((segment): segment is string => segment !== null)
                .join(separator);
              const line = [segmentLine, statuses]
                .filter(Boolean)
                .join(separator);

              let composed = line;
              if (mcpSummaryWidth > 0) {
                if (mcpSummaryWidth >= width) {
                  composed = mcpSummary;
                } else {
                  const leftWidth = visibleWidth(line);
                  const gap = width - leftWidth - mcpSummaryWidth;
                  if (gap >= 1) {
                    composed = `${line}${" ".repeat(gap)}${mcpSummary}`;
                  } else {
                    const truncatedLeft = truncateToWidth(
                      line,
                      Math.max(0, width - mcpSummaryWidth - 1)
                    );
                    composed =
                      truncatedLeft.length > 0
                        ? `${truncatedLeft} ${mcpSummary}`
                        : mcpSummary;
                  }
                }
              }

              cachedLine = composed;
              lastStickyFooterLine = cachedLine;
              return [truncateToWidth(cachedLine, width)];
            } catch {
              return [
                truncateToWidth(cachedLine ?? lastStickyFooterLine, width),
              ];
            }
          },
        };
      });

      refresh(true);
    }

    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "custom" &&
        entry.customType === "pi-statusbar-token-avg"
      ) {
        const data = entry.data as {
          lastCompletedRate?: number;
          currentAvgRate?: number;
          lastCompletedTokenCount?: number;
          lastTTFT?: number | null;
          hasData?: boolean;
        };
        if (data.hasData) {
          tracker.restore(data);
        }
      }
    }

    refresh(true);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    const snap = tracker.snapshot();
    if (snap.hasData) {
      pi.appendEntry("pi-statusbar-token-avg", snap);
    }
    tracker.destroy();
  });
}
