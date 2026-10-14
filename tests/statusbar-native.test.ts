import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, beforeEach, afterEach, vi, describe, expect, it } from "vitest";
import initStatusBar from "../extensions/pi-statusbar.js";
import { stripAnsi } from "../src/formatters.js";

// Opt in with an explicit SDK checkout; ordinary old-host unit tests need no native API.
// Alias the three public Pi package imports to this same host when running Vitest.
const sdkRoot = process.env.PI_STATUSBAR_SDK_ROOT;
const version = sdkRoot ? JSON.parse(readFileSync(join(sdkRoot,
  "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version : "";
let sdk: any;
let ai: any;
const virtual = version === "1.2.0";

describe.skipIf(!sdkRoot)("public SDK footer integration", () => {
  beforeEach(() => {
    vi.stubEnv("PI_STATUSBAR_NERD_FONTS", "0");
    vi.stubEnv("PI_STATUSBAR_SHOW", "directory,model,context,tokens,cost");
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeAll(async () => {
    sdk = await import(/* @vite-ignore */ pathToFileURL(join(sdkRoot!, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
    ai = await import(/* @vite-ignore */ pathToFileURL(join(sdkRoot!, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
  });

  async function fixture(options: { manager?: any; virtual?: boolean; historical?: (manager: any) => void } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "statusbar-native-"));
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(),
      modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
    });
    // Do not let environment credentials or built-in catalogs enter the fixture.
    for (const provider of runtime.getProviders()) runtime.registerNativeProvider({
      ...provider, auth: { apiKey: { name: "Offline only", resolve: async () => undefined } }, filterModels: () => [],
    });
    const fake = ai.fauxProvider({ provider: "statusbar-offline", tokensPerSecond: 1000000, models: [
      { id: "gpt-a", reasoning: true, contextWindow: 128000 },
      { id: "claude-b", reasoning: true, contextWindow: 256000 },
      { id: "auto", reasoning: true },
    ] });
    for (const model of fake.models) model.thinkingLevelMap = { low: "low", high: "high", xhigh: "xhigh" };
    runtime.registerNativeProvider(fake.provider);
    const manager = options.manager ?? sdk.SessionManager.inMemory(directory);
    options.historical?.(manager); // Canonical history precedes the SDK factory.
    const settings = sdk.SettingsManager.inMemory({
      defaultProvider: "statusbar-offline", defaultModel: "gpt-a", defaultThinkingLevel: "high",
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
    });
    const statuses = new Map<string, string>();
    const errors: string[] = [];
    let footer: any;
    let selectedRoute = "gpt-a";
    let routeError = false;
    let lastContext: any;
    const eventFrames: { line: string; persisted: boolean }[] = [];
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const ui = {
      setFooter(factory: any) { footer?.dispose(); footer = factory?.({ requestRender() {} }, theme, { getExtensionStatuses: () => statuses }); },
      setStatus(key: string, text?: string) { if (text === undefined) statuses.delete(key); else statuses.set(key, text); },
      notify() {},
    };
    const factories = [initStatusBar, (pi: any) => {
      if (options.virtual) pi.registerVirtualModel({
        provider: "synthetic-router", id: "auto", name: "Synthetic auto", thinkingLevels: ["low", "high"],
        route(_request: any, ctx: any) {
          if (routeError) throw new Error("offline route rejected");
          return { model: ctx.modelRegistry.find("statusbar-offline", selectedRoute), thinkingLevel: selectedRoute === "gpt-a" ? "high" : "xhigh" };
        },
      });
      pi.on("session_start", (_event: any, ctx: any) => { lastContext = ctx; ctx.ui.setStatus("random-owner", "native status"); });
      pi.on("message_end", (event: any, ctx: any) => {
        if (event.message.role !== "assistant") return;
        eventFrames.push({ line: stripAnsi(footer.render(400)[0]), persisted: ctx.sessionManager.getBranch().some((entry: any) => entry.type === "message" && entry.message === event.message) });
      });
    }];
    const services = await sdk.createAgentSessionServices({ cwd: directory, agentDir: directory, modelRuntime: runtime, settingsManager: settings,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: factories },
    });
    errors.push(...services.diagnostics.filter((item: any) => item.type === "error").map((item: any) => item.message));
    const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: manager, tools: [] });
    await session.bindExtensions({ mode: "tui", uiContext: ui, onError: (error: any) => errors.push(error.error) });
    await runtime.refresh({ allowNetwork: false });
    return {
      session, manager, runtime, fake, errors, statuses, eventFrames,
      get context() { return lastContext; },
      line: () => stripAnsi(footer.render(400)[0]),
      route(id: string) { selectedRoute = id; },
      failRouting() { routeError = true; },
      async selectVirtual() { await session.setModel(runtime.getModel("synthetic-router", "auto")); session.setThinkingLevel("low"); },
      async respond(stopReason = "stop") {
        fake.setResponses([ai.fauxAssistantMessage("offline response", { stopReason, errorMessage: stopReason === "error" ? "offline failure" : undefined })]);
        await session.prompt("offline request");
      },
      close() { session.dispose(); rmSync(directory, { recursive: true, force: true }); },
    };
  }

  it("loads and prompts on a physical host without registering any virtual model or Auto extension", async () => {
    const f = await fixture();
    try {
      expect(f.line()).toContain("gpt-a high");
      expect(f.line()).not.toContain("last observed");
      await f.respond();
      await f.session.setModel(f.runtime.getModel("statusbar-offline", "auto"));
      f.session.setThinkingLevel("xhigh");
      expect(f.line()).toContain("auto xhigh");
      expect(f.line()).not.toMatch(/selected auto|last observed/);
      expect(f.context.getVirtualModelState).toBeUndefined();
      expect(f.fake.state.callCount).toBe(1);
      expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });

  it("renders native setStatus text and status-only changes", async () => {
    const f = await fixture();
    try {
      expect(f.line()).toContain("native status");
      f.context.ui.setStatus("second-opaque-owner", "second status");
      expect(f.line()).toContain("native status · second status");
      f.context.ui.setStatus("random-owner", undefined);
      expect(f.line()).not.toContain("native status");
      expect(f.line()).toContain("second status");
      expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });

  it.runIf(virtual)("renders actual routed A/high and B/xhigh, before persistence, without changing the selected pair", async () => {
    process.env.PI_STATUSBAR_NERD_FONTS = "1";
    const f = await fixture({ virtual: true });
    try {
      await f.selectVirtual();
      expect(f.line()).toContain("auto low");
      await f.respond();
      expect(f.line()).toContain("\uf4b8 gpt-a high");
      expect(f.eventFrames.at(-1)).toMatchObject({ persisted: false });
      expect(f.eventFrames.at(-1)?.line).toContain("\uf4b8 gpt-a high");
      f.route("claude-b"); await f.respond();
      expect(f.line()).toContain("\uec82 claude-b xhigh");
      expect(f.session.model?.api).toBe("pi-virtual");
      expect(f.session.thinkingLevel).toBe("low");
      expect(f.fake.state.callCount).toBe(2);
      expect(f.errors).toEqual([]);
    } finally { f.close(); delete process.env.PI_STATUSBAR_NERD_FONTS; }
  });

  it.runIf(virtual)("refreshes A/B tree navigation, context and cost, and resumes only the active branch", async () => {
    let a = "";
    let b = "";
    const f = await fixture({ virtual: true, historical(manager) {
      manager.appendModelChange("synthetic-router", "auto");
      manager.appendThinkingLevelChange("low");
      manager.appendMessage({ role: "user", content: "restored conversation", timestamp: 0 });
      for (const [id, effort, cost] of [["gpt-a", "high", 0.25], ["claude-b", "xhigh", 0.50]]) {
        const message = ai.fauxAssistantMessage("restored response");
        Object.assign(message, { provider: "statusbar-offline", model: id, api: "faux", thinkingLevel: effort });
        message.usage = { ...message.usage, input: 12000, output: 10, totalTokens: 12010, cost: { ...message.usage.cost, total: cost } };
        const leaf = manager.appendMessage(message);
        if (id === "gpt-a") a = leaf; else b = leaf;
      }
    } });
    let resumed: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      expect(f.session.messages.filter((message: any) => message.role === "assistant")).toHaveLength(2);
      expect(f.line()).toContain("claude-b xhigh");
      expect(f.line()).toContain("256k used");
      expect(f.line()).toContain("$0.75");
      await f.session.navigateTree(a, { summarize: false });
      expect(f.line()).toContain("gpt-a high");
      expect(f.line()).toContain("128k used");
      expect(f.line()).not.toContain("claude-b");
      await f.session.navigateTree(b, { summarize: false });
      expect(f.line()).toContain("claude-b xhigh");
      expect(f.line()).toContain("$0.75");
      await f.session.navigateTree(a, { summarize: false });
      const expectedCost = f.manager.getBranch().filter((entry: any) => entry.type === "message" && entry.message.role === "assistant").reduce((sum: number, entry: any) => sum + entry.message.usage.cost.total, 0);
      expect(expectedCost).toBe(0.25);
      expect(f.line()).toContain("$0.25");
      expect(f.line()).not.toContain("$0.75");
      resumed = await fixture({ virtual: true, manager: f.manager });
      expect(resumed.line()).toContain("gpt-a high");
      expect(resumed.line()).not.toContain("claude-b");
      expect(resumed.line()).toContain("$0.25");
      expect(resumed.session.messages.filter((message: any) => message.role === "assistant")).toHaveLength(1);
      expect(resumed.fake.state.callCount).toBe(0);
      expect([...f.errors, ...resumed.errors]).toEqual([]);
    } finally { resumed?.close(); f.close(); }
  });

  it.runIf(virtual)("keeps successful A after native failed B, aborted B and routing errors; physical selection still wins", async () => {
    const f = await fixture({ virtual: true });
    try {
      await f.selectVirtual(); await f.respond();
      f.route("claude-b"); await f.respond("error");
      const latest = () => f.session.messages.filter((message: any) => message.role === "assistant").at(-1);
      expect(latest()).toMatchObject({ stopReason: "error", provider: "statusbar-offline", model: "claude-b", thinkingLevel: "xhigh" });
      expect(f.line()).toContain("gpt-a high");
      expect(f.line()).not.toContain("claude-b");
      await f.respond("aborted");
      expect(latest()).toMatchObject({ stopReason: "aborted", provider: "statusbar-offline", model: "claude-b", thinkingLevel: "xhigh" });
      expect(f.line()).toContain("gpt-a high");
      expect(f.line()).not.toContain("claude-b");
      f.failRouting(); await f.respond();
      const last = f.session.messages.filter((message: any) => message.role === "assistant").at(-1);
      expect(last.stopReason).toBe("error");
      expect(last.errorMessage).toContain("offline route rejected");
      expect(f.line()).toContain("gpt-a high");
      await f.session.setModel(f.runtime.getModel("statusbar-offline", "claude-b"));
      f.session.setThinkingLevel("xhigh");
      expect(f.line()).toContain("claude-b xhigh");
      expect(f.line()).not.toMatch(/last observed|selected auto/);
      expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });

  it.runIf(virtual)("shows virtual model before a successful response even after native routing failure", async () => {
    const f = await fixture({ virtual: true });
    try {
      await f.selectVirtual(); f.failRouting(); await f.respond();
      const last = f.session.messages.filter((message: any) => message.role === "assistant").at(-1);
      expect(last.stopReason).toBe("error");
      expect(last.errorMessage).toContain("offline route rejected");
      expect(f.line()).toContain("auto low");
      expect(f.line()).not.toContain("last observed");
      expect(f.fake.state.callCount).toBe(0);
      expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });

  it.runIf(virtual).each(["no effort", "missing model", "virtual target", "failed only", "aborted only"])("restores honest historical metadata: %s", async (kind) => {
    const f = await fixture({ virtual: true, historical(manager) {
      manager.appendModelChange("synthetic-router", "auto");
      manager.appendThinkingLevelChange("low");
      const message = ai.fauxAssistantMessage("historical");
      message.provider = kind === "virtual target" ? "synthetic-router" : "statusbar-offline";
      message.model = kind === "missing model" ? "not-in-catalog" : kind === "virtual target" ? "auto" : "claude-b";
      message.api = kind === "virtual target" ? "pi-virtual" : "faux";
      message.stopReason = kind === "failed only" ? "error" : kind === "aborted only" ? "aborted" : "stop";
      manager.appendMessage(message);
    } });
    try {
      expect(f.session.model?.api).toBe("pi-virtual");
      if (kind === "no effort") {
        expect(f.line()).toContain("claude-b low");
        expect(f.line()).not.toMatch(/claude-b (high|xhigh)/);
      } else {
        expect(f.line()).toContain("auto low");
        expect(f.line()).not.toContain("claude-b");
      }
      expect(f.fake.state.callCount).toBe(0);
      expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });
});
