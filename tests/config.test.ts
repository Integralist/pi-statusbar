import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isSegmentName,
  parseSegments,
  serializeSegments,
  parseSerializedSegments,
  splitSegmentNames,
  describeSegments,
  readGlobalConfig,
  readGlobalSegments,
  writeGlobalConfig,
  writeGlobalSegments,
  ALL_SEGMENTS,
  DEFAULT_SEGMENTS,
} from "../src/config.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("src/config", () => {
  let tempDir: string;
  let tempConfigFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-statusbar-config-"));
    tempConfigFile = join(tempDir, "config.json");
    delete process.env.PI_STATUSBAR_SHOW;
    delete process.env.PI_STATUSBAR_CONFIG;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PI_STATUSBAR_SHOW;
    delete process.env.PI_STATUSBAR_CONFIG;
  });

  describe("isSegmentName", () => {
    it("returns true for valid segment names", () => {
      for (const seg of ALL_SEGMENTS) {
        expect(isSegmentName(seg)).toBe(true);
      }
    });

    it("returns false for invalid segment names", () => {
      expect(isSegmentName("git")).toBe(false);
      expect(isSegmentName("")).toBe(false);
      expect(isSegmentName("unknown")).toBe(false);
    });
  });

  describe("parseSegments", () => {
    it("returns default segments when env is empty", () => {
      expect(parseSegments()).toEqual(DEFAULT_SEGMENTS);
      expect(parseSegments("")).toEqual(DEFAULT_SEGMENTS);
    });

    it("parses valid segment names from comma-separated string", () => {
      expect(parseSegments("directory,cost")).toEqual(["directory", "cost"]);
      expect(parseSegments("MODEL, TOKENS ")).toEqual(["model", "tokens"]);
    });

    it("falls back to default if no valid segments matched", () => {
      expect(parseSegments("foo,bar")).toEqual(DEFAULT_SEGMENTS);
    });
  });

  describe("serializeSegments", () => {
    it("filters and sorts segments by canonical order", () => {
      expect(serializeSegments(["cost", "directory"])).toEqual([
        "directory",
        "cost",
      ]);
    });
  });

  describe("parseSerializedSegments", () => {
    it("returns null for non-array inputs", () => {
      expect(parseSerializedSegments(null)).toBeNull();
      expect(parseSerializedSegments("directory")).toBeNull();
      expect(parseSerializedSegments({})).toBeNull();
    });

    it("extracts valid segment names and canonicalizes order", () => {
      expect(
        parseSerializedSegments(["tokens", "unknown", "model"])
      ).toEqual(["model", "tokens"]);
    });
  });

  describe("splitSegmentNames", () => {
    it("splits whitespace and comma-separated tokens", () => {
      expect(splitSegmentNames("directory, model tokens")).toEqual([
        "directory",
        "model",
        "tokens",
      ]);
      expect(splitSegmentNames("invalid, cost")).toEqual(["cost"]);
    });
  });

  describe("describeSegments", () => {
    it("describes empty segments as showing none", () => {
      expect(describeSegments([])).toBe("showing none");
    });

    it("describes list of segment labels", () => {
      expect(describeSegments(["directory", "cost"])).toBe(
        "showing: CWD, Cost"
      );
    });
  });

  describe("readGlobalConfig & writeGlobalConfig", () => {
    it("reads empty config if file does not exist", () => {
      expect(readGlobalConfig(tempConfigFile)).toEqual({});
    });

    it("writes and reads global config", () => {
      writeGlobalConfig({ segments: ["directory", "model"] }, tempConfigFile);
      expect(existsSync(tempConfigFile)).toBe(true);

      const read = readGlobalConfig(tempConfigFile);
      expect(read.segments).toEqual(["directory", "model"]);
    });

    it("persists segments via writeGlobalSegments", () => {
      writeGlobalSegments(["cost", "context"], tempConfigFile);
      const raw = JSON.parse(readFileSync(tempConfigFile, "utf8"));
      expect(raw.segments).toEqual(["context", "cost"]);
    });

    it("reads segments with fallback to defaults", () => {
      expect(readGlobalSegments(tempConfigFile)).toEqual(DEFAULT_SEGMENTS);

      writeGlobalSegments(["directory"], tempConfigFile);
      // readGlobalSegments unions with DEFAULT_SEGMENTS to preserve new defaults
      const loaded = readGlobalSegments(tempConfigFile);
      expect(loaded).toContain("directory");
      expect(loaded).toContain("model");
    });

    it("respects PI_STATUSBAR_SHOW override", () => {
      process.env.PI_STATUSBAR_SHOW = "directory,cost";
      expect(readGlobalSegments(tempConfigFile)).toEqual(["directory", "cost"]);
    });
  });
});
