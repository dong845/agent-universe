// Spec 12.4: sessions are grouped by repository, so work started in different subdirectories of one
// repo is one town. A worktree has a `.git` file of its own; `mainRepoOf` leads it back to its repo (v3).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const defaultMarker = (dir: string): boolean => existsSync(join(dir, ".git"));

/** the path one level up, for both / and \ separators; null at the top */
function parent(p: string): string | null {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return null;
  if (i === 0) return p.length > 1 ? p[0] : null;
  return p.slice(0, i);
}

/** the nearest directory at or above `dir` holding a `.git` (dir or file); null if none */
export function gitRoot(dir: string, isGitMarker: (dir: string) => boolean = defaultMarker): string | null {
  for (let d: string | null = dir; d !== null; d = parent(d)) {
    if (isGitMarker(d)) return d;
  }
  return null;
}

/** the repo holding `cwd`, else `cwd` itself */
export function projectRoot(cwd: string, isGitMarker: (dir: string) => boolean = defaultMarker): string {
  return gitRoot(cwd, isGitMarker) ?? cwd;
}

/**
 * a worktree (its `.git` is a file `gitdir: <main>/.git/worktrees/<name>`) → the main repository;
 * anything else, including an unreadable or garbled `.git` file, → `root` itself
 */
export function mainRepoOf(root: string): string {
  const git = join(root, ".git");
  let text: string;
  try {
    if (!statSync(git).isFile()) return root;
    text = readFileSync(git, "utf8");
  } catch {
    return root;
  }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return root;
  const gitdir = resolve(root, m[1]);
  const w = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(gitdir);
  return w && existsSync(join(w[1], ".git")) ? w[1] : root;
}
