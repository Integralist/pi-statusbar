import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

export type GitExecutor = (
  file: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding
) => string;

interface BranchCacheEntry {
  branch: string | null;
  expiresAt: number;
}

const defaultGitExecutor: GitExecutor = (file, args, options) => {
  return execFileSync(file, args, options);
};

const branchCache = new Map<string, BranchCacheEntry>();
export const BRANCH_CACHE_TTL_MS = 2000;

export function clearGitBranchCache(): void {
  branchCache.clear();
}

export function getGitBranch(
  cwd: string,
  executor: GitExecutor = defaultGitExecutor
): string | null {
  const now = Date.now();
  const cached = branchCache.get(cwd);
  if (cached && cached.expiresAt > now) {
    return cached.branch;
  }

  let branch: string | null = null;
  try {
    const output = executor("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
      encoding: "utf8",
    }).trim();
    branch = output.length > 0 ? output : null;
  } catch {
    branch = null;
  }

  branchCache.set(cwd, { branch, expiresAt: now + BRANCH_CACHE_TTL_MS });
  return branch;
}
