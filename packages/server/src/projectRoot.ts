// Spec 12.4: sessions are grouped by repository, so work started in different subdirectories of one
// repo is one town. A worktree has a `.git` file of its own and stays its own town.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const defaultMarker = (dir: string): boolean => existsSync(join(dir, ".git"));

/** the path one level up, for both / and \ separators; null at the top */
function parent(p: string): string | null {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return null;
  if (i === 0) return p.length > 1 ? p[0] : null;
  return p.slice(0, i);
}

/** the nearest directory at or above `cwd` holding a `.git` (dir or file); `cwd` itself if none */
export function projectRoot(cwd: string, isGitMarker: (dir: string) => boolean = defaultMarker): string {
  for (let d: string | null = cwd; d !== null; d = parent(d)) {
    if (isGitMarker(d)) return d;
  }
  return cwd;
}
