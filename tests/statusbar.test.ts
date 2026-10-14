import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import initStatusBar from "../extensions/pi-statusbar.js";
import { clearGitBranchCache, setGitExecutor } from "../src/git.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../src/formatters.js";

describe("pi-statusbar footer extension", () => {
  let handlers: Record<string, ((...args: unknown[]) => unknown)[]>;
  let commands: Record<string, { description: string; handler: (args: string, ctx: unknown) => unknown }>;
  let mockApi: any;
  let mockContext: any;
  let mockTheme: any;
  let installedFooterFactory: any;

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("PI_STATUSBAR_NERD_FONTS", "0");
    vi.stubEnv("PI_STATUSBAR_SHOW", "directory,model,context,tokens,cost");
    clearGitBranchCache();
    setGitExecutor(null);
    vi.restoreAllMocks();

    handlers = {};
    commands = {};
    installedFooterFactory = null;

    mockApi = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
      }),
      registerCommand: vi.fn((name: string, config: any) => {
        commands[name] = config;
      }),
      getAllTools: vi.fn().mockReturnValue([]),
      getThinkingLevel: vi.fn().mockReturnValue("high"),
      appendEntry: vi.fn(),
    };

    mockTheme = {
      fg: (_color: string, text: string) => `\x1b[38;2;140;140;140m${text}\x1b[0m`,
      bold: (text: string) => text,
    };

    mockContext = {
      hasUI: true,
      cwd: "/Users/testuser/code/project",
      model: { id: "anthropic/claude-3-7-sonnet" },
      sessionManager: {
        getBranch: vi.fn().mockReturnValue([
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { cost: { total: 0.1061 } },
            },
          },
        ]),
      },
      getContextUsage: vi.fn().mockReturnValue({
        percent: 2.3,
        contextWindow: 1048576,
      }),
      ui: {
        setFooter: vi.fn((factory: any) => {
          installedFooterFactory = factory;
        }),
        notify: vi.fn(),
      },
    };
  });

  it("registers event listeners and command", () => {
    initStatusBar(mockApi);

    expect(mockApi.registerCommand).toHaveBeenCalledWith("statusbar", expect.any(Object));
    expect(mockApi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("turn_start", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("message_end", expect.any(Function));
  });

  it("renders statusbar with branch on non-main branch", async () => {
    setGitExecutor(() => "feat/test\n");

    initStatusBar(mockApi);

    const sessionStartHandlers = handlers["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ type: "session_start" }, mockContext);
    }

    expect(mockContext.ui.setFooter).toHaveBeenCalled();
    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    const lines = footer.render(120);

    expect(lines.length).toBe(1);
    const cleanLine = stripAnsi(lines[0]);

    expect(cleanLine).toContain("claude-3-7-sonnet high");
    expect(cleanLine).toContain("(feat/test)");
    expect(cleanLine).toContain("2.3% of 1.0M used");
    expect(cleanLine).toContain("$0.11");
    expect(lines[0]).toContain("\x1b[38;2;80;220;80m$0.11\x1b[0m");
  });

  it("renders statusbar without branch on main branch", async () => {
    setGitExecutor(() => "main\n");

    initStatusBar(mockApi);

    const sessionStartHandlers = handlers["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ type: "session_start" }, mockContext);
    }

    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    const lines = footer.render(120);
    const cleanLine = stripAnsi(lines[0]);

    expect(cleanLine).toContain("claude-3-7-sonnet high");
    expect(cleanLine).not.toContain("(main)");
    expect(cleanLine).toContain("$0.11");
  });

  it("renders model icon when PI_STATUSBAR_NERD_FONTS is enabled", async () => {
    process.env.PI_STATUSBAR_NERD_FONTS = "1";
    try {
      initStatusBar(mockApi);

      const sessionStartHandlers = handlers["session_start"] || [];
      for (const h of sessionStartHandlers) {
        await h({ type: "session_start" }, mockContext);
      }

      const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
      const lines = footer.render(120);
      const cleanLine = stripAnsi(lines[0]);

      expect(cleanLine).toContain("\uec82 claude-3-7-sonnet high");
    } finally {
      delete process.env.PI_STATUSBAR_NERD_FONTS;
    }
  });

  it.each([
    [4.7, "\x1b[38;2;80;220;80m"],
    [20, "\x1b[38;2;255;215;0m"],
    [40, "\x1b[38;2;255;165;0m"],
    [50, "\x1b[38;2;255;80;80m"],
  ])("renders context usage of %s percent in its threshold color", async (percent, color) => {
    mockContext.getContextUsage.mockReturnValue({ percent, contextWindow: 1048576 });
    initStatusBar(mockApi);
    for (const h of handlers["session_start"] || []) {
      await h({ type: "session_start" }, mockContext);
    }

    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    expect(footer.render(200)[0]).toContain(`${color}${percent.toFixed(1)}% of 1.0M used\x1b[0m`);
  });

  it("renders uncoloured placeholders before telemetry exists and while waiting for output", async () => {
    initStatusBar(mockApi);
    for (const h of handlers["session_start"] || []) {
      await h({ type: "session_start" }, mockContext);
    }
    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    let line = footer.render(200)[0];
    expect(line).toContain("\x1b[0m TTFT —");
    expect(line).toContain("\x1b[0m — TPS");

    for (const h of handlers["turn_start"] || []) {
      await h({ type: "turn_start" }, mockContext);
    }
    line = footer.render(200)[0];
    expect(line).toContain("\x1b[0m TTFT —");
    expect(line).toContain("\x1b[0m — TPS");
  });

  it.each([
    [0.2, 50, "\x1b[38;2;80;220;80m", "\x1b[38;2;255;215;0m", "0.20s", "50"],
    [2, 60, "\x1b[38;2;255;215;0m", "\x1b[38;2;80;220;80m", "2.00s", "60"],
    [3, 20, "\x1b[38;2;255;165;0m", "\x1b[38;2;255;165;0m", "3.00s", "20"],
    [5, 10, "\x1b[38;2;255;80;80m", "\x1b[38;2;255;80;80m", "5.00s", "10"],
    [0, 10, "\x1b[38;2;80;220;80m", "\x1b[38;2;255;80;80m", "0.00s", "10"],
    [100, 10000, "\x1b[38;2;255;80;80m", "\x1b[38;2;80;220;80m", "100s", "9999+"],
  ])("renders %s seconds TTFT and %s TPS in their threshold colors", async (ttft, rate, ttftColor, tpsColor, ttftLabel, tpsLabel) => {
    initStatusBar(mockApi);

    const sessionStartHandlers = handlers["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ type: "session_start" }, mockContext);
    }

    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const turnStartHandlers = handlers["turn_start"] || [];
    for (const h of turnStartHandlers) {
      await h({ type: "turn_start" }, mockContext);
    }

    now = 1000 + ttft * 1000;
    const messageUpdateHandlers = handlers["message_update"] || [];
    for (const h of messageUpdateHandlers) {
      await h({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "hello",
          partial: {
            role: "assistant",
            content: [],
            usage: { output: rate / 2 },
          },
        },
      }, mockContext);
    }

    now += 500; // half a second of streaming, with fewer tokens than TPS
    const messageEndHandlers = handlers["message_end"] || [];
    for (const h of messageEndHandlers) {
      await h({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { output: rate / 2 },
        },
      }, mockContext);
    }

    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    const lines = footer.render(120);
    const cleanLine = stripAnsi(lines[0]);

    expect(cleanLine).toContain(`TTFT ${ttftLabel}`);
    expect(cleanLine).toContain(`${tpsLabel} TPS`);
    expect(lines[0]).toContain(`${ttftColor}TTFT ${ttftLabel}\x1b[0m`);
    expect(lines[0]).toContain(`${tpsColor}${tpsLabel} TPS\x1b[0m`);

    for (const h of handlers["model_select"] || []) {
      await h({ type: "model_select" }, mockContext);
    }
    const resetLine = footer.render(200)[0];
    expect(resetLine).toContain("\x1b[0m TTFT —");
    expect(resetLine).toContain("\x1b[0m — TPS");
  });

  async function emit(type: string, event: Record<string, unknown> = {}) {
    for (const handler of handlers[type] || []) await handler({ type, ...event }, mockContext);
  }

  async function startFooter(statuses = new Map<string, string>()) {
    initStatusBar(mockApi);
    await emit("session_start");
    return installedFooterFactory({ requestRender: vi.fn() }, mockTheme, {
      getExtensionStatuses: () => statuses,
    });
  }

  function response(model = "gpt-a", thinkingLevel: string | undefined = "high", stopReason = "stop") {
    return { role: "assistant", provider: "offline", model, thinkingLevel, stopReason, usage: { cost: { total: 0.25 } } };
  }

  function virtualContext(branch: unknown[] = []) {
    mockContext.model = { id: "auto", provider: "synthetic", api: "pi-virtual" };
    mockApi.getThinkingLevel.mockReturnValue("low");
    mockContext.modelRegistry = { find: (provider: string, id: string) =>
      provider === "offline" && ["gpt-a", "claude-b"].includes(id)
        ? { id, api: "offline-api", provider } : undefined };
    mockContext.sessionManager.getBranch.mockReturnValue(branch);
  }

  it("preserves the exact no-status physical layout and accepts missing footerData on older callers", async () => {
    process.env.PI_STATUSBAR_SHOW = "model,context,cost";
    try {
      const footer = await startFooter();
      expect(stripAnsi(footer.render(200)[0])).toBe("claude-3-7-sonnet high · 2.3% of 1.0M used · $0.11");
      const oldCaller = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
      expect(stripAnsi(oldCaller.render(200)[0])).toBe("claude-3-7-sonnet high · 2.3% of 1.0M used · $0.11");
    } finally { delete process.env.PI_STATUSBAR_SHOW; }
  });

  it("keeps the established MCP right edge when no extension statuses exist", async () => {
    process.env.PI_STATUSBAR_SHOW = "model";
    mockApi.getAllTools.mockReturnValue([{ name: "mcp_alpha_read", description: "[MCP: alpha] read" }]);
    const footer = await startFooter();
    const left = "claude-3-7-sonnet high";
    const right = "MCP 1 · Tools 1";
    expect(stripAnsi(footer.render(80)[0])).toBe(left + " ".repeat(80 - visibleWidth(left) - visibleWidth(right)) + right);
  });

  it("renders arbitrary extension statuses and observes additions, updates and removals without events", async () => {
    const statuses = new Map([["unrecognized-owner", "one"], ["another-owner", "two"]]);
    const footer = await startFooter(statuses);
    expect(stripAnsi(footer.render(300)[0])).toContain("one · two");
    statuses.set("unrecognized-owner", "changed");
    statuses.set("third-owner", "three");
    expect(stripAnsi(footer.render(300)[0])).toContain("changed · two · three");
    statuses.clear();
    expect(stripAnsi(footer.render(300)[0])).not.toMatch(/changed|two|three/);
  });

  it("fits ANSI, wide text and Nerd Font statuses at narrow widths", async () => {
    process.env.PI_STATUSBAR_NERD_FONTS = "1";
    try {
      const footer = await startFooter(new Map([["arbitrary", "\x1b[31m界\n\t é 🤖\x1b[0m"]]));
      for (const width of [1, 2, 5, 12, 40, 120]) {
        expect(visibleWidth(footer.render(width)[0])).toBeLessThanOrEqual(width);
      }
      expect(stripAnsi(footer.render(300)[0])).toContain("界 é 🤖");
    } finally { delete process.env.PI_STATUSBAR_NERD_FONTS; }
  });

  it("shows selected virtual settings separately from pending physical evidence", async () => {
    virtualContext();
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("selected auto low; physical pending/unknown");
  });

  it("uses matching response model, effort and icon before message_end is persisted", async () => {
    virtualContext();
    process.env.PI_STATUSBAR_NERD_FONTS = "1";
    try {
      const footer = await startFooter();
      footer.render(300);
      await emit("message_end", { message: response() });
      expect(mockContext.sessionManager.getBranch()).toEqual([]);
      const line = stripAnsi(footer.render(300)[0]);
      expect(line).toContain("last observed \uf4b8 gpt-a high");
      expect(line).not.toContain("gpt-a low");
    } finally { delete process.env.PI_STATUSBAR_NERD_FONTS; }
  });

  it.each(["error", "aborted", "pending", "deferred"])("does not treat %s metadata as successful evidence", async (stopReason) => {
    virtualContext([{ type: "message", message: response() }]);
    const footer = await startFooter();
    await emit("message_end", { message: response("claude-b", "xhigh", stopReason) });
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed gpt-a high");
    expect(stripAnsi(footer.render(300)[0])).not.toContain("claude-b");
  });

  it("keeps effort unknown when the latest successful historical response lacks it", async () => {
    const historical = response("claude-b");
    delete (historical as { thinkingLevel?: string }).thinkingLevel;
    virtualContext([{ type: "message", message: response() }, { type: "message", message: historical }]);
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed claude-b effort unknown");
    expect(stripAnsi(footer.render(300)[0])).not.toMatch(/claude-b (low|high)/);
  });

  it.each(["missing", "virtual"])("does not substitute older evidence for an unresolved %s catalog target", async (kind) => {
    virtualContext([{ type: "message", message: response() }, { type: "message", message: response("unknown", "xhigh") }]);
    if (kind === "virtual") mockContext.modelRegistry.find = () => ({ id: "unknown", api: "pi-virtual" });
    const footer = await startFooter();
    const line = stripAnsi(footer.render(300)[0]);
    expect(line).toContain("physical pending/unknown");
    expect(line).not.toContain("last observed");
  });

  it("physical selection named auto and selected effort outrank older observed metadata", async () => {
    virtualContext([{ type: "message", message: response() }]);
    mockContext.model = { id: "auto", api: "offline-api" };
    mockApi.getThinkingLevel.mockReturnValue("xhigh");
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("auto xhigh");
    expect(stripAnsi(footer.render(300)[0])).not.toMatch(/last observed|selected auto|gpt-a/);
  });

  it("tree refresh resets branch observation, context usage and cost at the same width", async () => {
    virtualContext([{ type: "message", message: response() }]);
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed gpt-a high");
    mockContext.sessionManager.getBranch.mockReturnValue([]);
    mockContext.getContextUsage.mockReturnValue({ percent: 0, contextWindow: 128000 });
    await emit("session_tree");
    const line = stripAnsi(footer.render(300)[0]);
    expect(line).toContain("physical pending/unknown");
    expect(line).toContain("0.0% of 128k used");
    expect(line).toContain("$0");
    expect(line).not.toContain("gpt-a");
  });

  it("selection and replacement session initialization cannot retain another branch observation", async () => {
    virtualContext([{ type: "message", message: response() }]);
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed gpt-a high");
    mockContext.sessionManager.getBranch.mockReturnValue([{ type: "message", message: response("claude-b", "xhigh") }]);
    await emit("model_select");
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed claude-b xhigh");
    mockContext.sessionManager.getBranch.mockReturnValue([]);
    await emit("session_start");
    const replacement = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    expect(stripAnsi(replacement.render(300)[0])).toContain("physical pending/unknown");
    expect(stripAnsi(replacement.render(300)[0])).not.toMatch(/gpt-a|claude-b/);
  });

  it("a finalized but unresolvable response clears older evidence instead of reusing its effort", async () => {
    virtualContext([{ type: "message", message: response() }]);
    const footer = await startFooter();
    expect(stripAnsi(footer.render(300)[0])).toContain("last observed gpt-a high");
    await emit("message_end", { message: response("not-in-catalog", "xhigh") });
    expect(stripAnsi(footer.render(300)[0])).toContain("physical pending/unknown");
    expect(stripAnsi(footer.render(300)[0])).not.toContain("last observed");
  });

  it("invalidate rebuilds cached themed output", async () => {
    const footer = await startFooter();
    footer.render(300);
    mockTheme.fg = (_color: string, text: string) => `\x1b[32m${text}\x1b[0m`;
    footer.invalidate();
    expect(footer.render(300)[0]).toContain("\x1b[32m·\x1b[0m");
  });

});
