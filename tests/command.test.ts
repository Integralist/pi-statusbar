import { describe, it, expect, beforeEach, vi } from "vitest";
import initStatusBar from "../extensions/pi-statusbar.js";
import { clearGitBranchCache } from "../src/git.js";

describe("/statusbar command", () => {
  let commands: Record<
    string,
    {
      description: string;
      handler: (args: string, ctx: any) => Promise<void>;
    }
  >;
  let mockApi: any;
  let mockContext: any;

  beforeEach(() => {
    clearGitBranchCache();
    vi.restoreAllMocks();

    commands = {};

    mockApi = {
      on: vi.fn(),
      registerCommand: vi.fn((name: string, config: any) => {
        commands[name] = config;
      }),
      getAllTools: vi.fn().mockReturnValue([]),
      getThinkingLevel: vi.fn().mockReturnValue("high"),
      appendEntry: vi.fn(),
    };

    mockContext = {
      hasUI: true,
      cwd: "/Users/testuser/code/project",
      ui: {
        custom: vi.fn(),
        notify: vi.fn(),
        setFooter: vi.fn(),
      },
    };

    initStatusBar(mockApi);
  });

  it("registers /statusbar command", () => {
    expect(commands["statusbar"]).toBeDefined();
    expect(commands["statusbar"].description).toContain("pi-statusbar");
  });

  it("handles empty args or 'config' by opening custom TUI dialog", async () => {
    const handler = commands["statusbar"].handler;

    await handler("", mockContext);
    expect(mockContext.ui.custom).toHaveBeenCalledTimes(1);

    await handler("config", mockContext);
    expect(mockContext.ui.custom).toHaveBeenCalledTimes(2);

    await handler("configure", mockContext);
    expect(mockContext.ui.custom).toHaveBeenCalledTimes(3);
  });

  it("handles 'list' subcommand", async () => {
    const handler = commands["statusbar"].handler;

    await handler("list", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-statusbar footer: showing:"),
      "info"
    );
  });

  it("handles 'segments all' and 'segments none'", async () => {
    const handler = commands["statusbar"].handler;

    await handler("segments none", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      "pi-statusbar footer: showing none",
      "info"
    );

    await handler("segments all", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("CWD"),
      "info"
    );
  });

  it("handles 'segments only <segments>'", async () => {
    const handler = commands["statusbar"].handler;

    await handler("segments only directory cost", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      "pi-statusbar footer: showing: CWD, Cost",
      "info"
    );
  });

  it("handles 'segments hide <name>' and 'segments show <name>'", async () => {
    const handler = commands["statusbar"].handler;

    await handler("segments only directory model cost", mockContext);
    await handler("segments hide model", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      "pi-statusbar footer: showing: CWD, Cost",
      "info"
    );

    await handler("segments show tokens", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      "pi-statusbar footer: showing: CWD, Tokens/s, Cost",
      "info"
    );
  });

  it("warns on empty segment list for only/show/hide", async () => {
    const handler = commands["statusbar"].handler;

    await handler("segments only", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Segments:"),
      "warning"
    );
  });

  it("shows usage warning on unknown subcommand", async () => {
    const handler = commands["statusbar"].handler;

    await handler("unknown-action", mockContext);
    expect(mockContext.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage: /statusbar"),
      "warning"
    );
  });
});
