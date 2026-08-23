import { describe, it, expect, beforeEach, vi } from "vitest";
import { getGitBranch, clearGitBranchCache, BRANCH_CACHE_TTL_MS, GitExecutor } from "../src/git.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("getGitBranch", () => {
  beforeEach(() => {
    clearGitBranchCache();
    vi.restoreAllMocks();
  });

  it("returns current branch name for a git repository", () => {
    const branch = getGitBranch(process.cwd());
    // Since this repo is on 'main', it should return 'main'
    expect(branch).toBe("main");
  });

  it("returns null for non-git directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "non-git-"));
    try {
      const branch = getGitBranch(tempDir);
      expect(branch).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("caches the result within TTL and does not re-exec", () => {
    const mockExecutor = vi.fn<GitExecutor>().mockReturnValue("feat/test\n");
    const cwd = "/fake/repo";

    const branch1 = getGitBranch(cwd, mockExecutor);
    expect(branch1).toBe("feat/test");
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const branch2 = getGitBranch(cwd, mockExecutor);
    expect(branch2).toBe("feat/test");
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });

  it("refreshes the result after TTL expires", () => {
    const mockExecutor = vi.fn<GitExecutor>().mockReturnValue("feat/test\n");
    const cwd = "/fake/repo";

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    getGitBranch(cwd, mockExecutor);
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    // Fast-forward past TTL
    vi.spyOn(Date, "now").mockReturnValue(now + BRANCH_CACHE_TTL_MS + 100);

    getGitBranch(cwd, mockExecutor);
    expect(mockExecutor).toHaveBeenCalledTimes(2);
  });

  it("returns null when git command throws or times out", () => {
    const mockExecutor = vi.fn<GitExecutor>().mockImplementation(() => {
      throw new Error("Git command failed");
    });

    const branch = getGitBranch("/some/path", mockExecutor);
    expect(branch).toBeNull();
  });

  it("returns null when git returns empty output", () => {
    const mockExecutor = vi.fn<GitExecutor>().mockReturnValue("   \n");
    const branch = getGitBranch("/some/path", mockExecutor);
    expect(branch).toBeNull();
  });
});
