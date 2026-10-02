/**
 * A browser folder picker returns one folder. When that folder is only a container for
 * product folders (no files of its own, two or more subfolders), drop its name so each
 * subfolder becomes a product folder, exactly as if they had been picked one by one.
 * Returns the container name when it was removed.
 */
export function collapseContainer(paths: string[]): { paths: string[]; root: string | null } {
  if (!paths.length) return { paths, root: null };
  const split = paths.map((p) => p.replace(/^\/+/, "").split("/"));
  const root = split[0][0];
  if (!split.every((s) => s.length >= 3 && s[0] === root)) return { paths, root: null };
  const second = new Set(split.map((s) => s[1]));
  if (second.size < 2) return { paths, root: null };
  return { paths: split.map((s) => s.slice(1).join("/")), root };
}

/** Distinct top-level folder names among relative paths (files without a folder are not counted). */
export function folderCount(paths: string[]): number {
  return new Set(paths.filter((p) => p.includes("/")).map((p) => p.split("/")[0])).size;
}
