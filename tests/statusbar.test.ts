import { describe, it, expect, beforeEach, vi } from "vitest";
import initStatusBar from "../extensions/pi-statusbar.js";
import { clearGitBranchCache, setGitExecutor } from "../src/git.js";
import { stripAnsi } from "../src/formatters.js";

describe("pi-statusbar footer extension", () => {
  let handlers: Record<string, ((...args: unknown[]) => unknown)[]>;
  let commands: Record<string, { description: string; handler: (args: string, ctx: unknown) => unknown }>;
  let mockApi: any;
  let mockContext: any;
  let mockTheme: any;
  let installedFooterFactory: any;

  beforeEach(() => {
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
});
