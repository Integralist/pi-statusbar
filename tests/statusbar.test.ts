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
      fg: (_color: string, text: string) => text,
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
    expect(cleanLine).toContain("$0.1061");
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
    expect(cleanLine).toContain("$0.1061");
  });

  it("renders streaming rate and TTFT when token delta events occur", async () => {
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

    now = 1200; // 200ms TTFT
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
            usage: { output: 25 },
          },
        },
      }, mockContext);
    }

    now = 1700; // 500ms streaming time for 25 tokens = 50 TPS
    const messageEndHandlers = handlers["message_end"] || [];
    for (const h of messageEndHandlers) {
      await h({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { output: 25 },
        },
      }, mockContext);
    }

    const footer = installedFooterFactory({ requestRender: vi.fn() }, mockTheme);
    const lines = footer.render(120);
    const cleanLine = stripAnsi(lines[0]);

    expect(cleanLine).toContain("TTFT 0.20s");
    expect(cleanLine).toContain("50 TPS");
  });
});
