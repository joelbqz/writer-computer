import { getFileStem, normalizePath } from "./paths";
import type { SearchResult } from "@/types/fs";

export type WikiLinkTarget = { kind: "internal"; path: string } | { kind: "unresolved" };
export interface ParsedWikiLink {
  raw: string;
  target: string;
  path: string;
  fragment: string | null;
  alias: string | null;
  displayText: string;
}

function unescapeWikiText(text: string): string {
  return text.replace(/\\\|/g, "|").trim();
}

function splitAlias(raw: string): { target: string; alias: string | null } {
  const separator = raw.indexOf("|");
  if (separator === -1) {
    return { target: raw, alias: null };
  }

  const escapedSeparator = separator > 0 && raw[separator - 1] === "\\";
  const targetEnd = escapedSeparator ? separator - 1 : separator;

  return {
    target: raw.slice(0, targetEnd),
    alias: unescapeWikiText(raw.slice(separator + 1)),
  };
}

function splitFragment(target: string): { path: string; fragment: string | null } {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) {
    return { path: target, fragment: null };
  }

  return {
    path: target.slice(0, hashIndex),
    fragment: target.slice(hashIndex + 1),
  };
}

export function parseWikiLink(raw: string): ParsedWikiLink {
  const { target, alias } = splitAlias(raw.trim());
  const normalizedTarget = unescapeWikiText(target);
  const { path, fragment } = splitFragment(normalizedTarget);
  const normalizedPath = normalizeWikiTarget(path);
  const fallbackDisplay = normalizedPath || (fragment ? `#${fragment}` : normalizedTarget);

  return {
    raw,
    target: normalizedTarget,
    path: normalizedPath,
    fragment,
    alias: alias || null,
    displayText: alias || fallbackDisplay,
  };
}

/**
 * Normalize a raw wiki-link target string for resolution:
 * trim whitespace, normalize backslashes, strip .md/.markdown extension.
 */
export function normalizeWikiTarget(raw: string): string {
  let target = raw.trim().replace(/\\/g, "/");
  target = target.replace(/^\/+/, "");
  const lower = target.toLowerCase();
  if (lower.endsWith(".md")) {
    target = target.slice(0, -3);
  } else if (lower.endsWith(".markdown")) {
    target = target.slice(0, -9);
  }
  return target;
}

/**
 * Resolve a wiki-link target to an internal file path or unresolved.
 *
 * - If the target contains `/`, treat it as a workspace-relative path (without extension).
 * - Otherwise, treat it as a stem lookup across the workspace.
 *   Resolves only when exactly one markdown file matches the stem.
 */
export async function resolveWikiLink(
  raw: string,
  workspaceRoot: string,
  fuzzySearch: (query: string, limit?: number) => Promise<SearchResult[]>,
  fileExists: (path: string) => Promise<boolean>,
  currentFilePath?: string | null,
): Promise<WikiLinkTarget> {
  const link = parseWikiLink(raw);
  const target = link.path;
  if (!target && link.fragment && currentFilePath) {
    return { kind: "internal", path: currentFilePath };
  }
  if (!target) return { kind: "unresolved" };

  if (target.includes("/")) {
    const basePath = normalizePath(`${workspaceRoot.replace(/\/$/, "")}/${target}`);
    for (const fullPath of [`${basePath}.md`, `${basePath}.markdown`]) {
      if (await fileExists(fullPath)) {
        return { kind: "internal", path: fullPath };
      }
    }
    return { kind: "unresolved" };
  }

  // Stem lookup: find all files whose stem matches (case-insensitive)
  const results = await fuzzySearch(target, 50);
  const targetLower = target.toLowerCase();
  const exactMatches = results.filter((r) => getFileStem(r.filename).toLowerCase() === targetLower);

  if (exactMatches.length === 1) {
    return { kind: "internal", path: exactMatches[0].path };
  }

  return { kind: "unresolved" };
}

/**
 * Compute the canonical insertion text for a selected file.
 * Uses the shortest unambiguous form: bare stem when unique,
 * workspace-relative path (without extension) when duplicate stems exist.
 */
export function canonicalWikiTarget(file: SearchResult, allFiles: SearchResult[]): string {
  const stem = getFileStem(file.filename);
  const stemLower = stem.toLowerCase();

  const hasDuplicate = allFiles.some(
    (f) => f.path !== file.path && getFileStem(f.filename).toLowerCase() === stemLower,
  );

  if (!hasDuplicate) return stem;

  return stripMdExtension(file.relative_path);
}

function stripMdExtension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return path.slice(0, -3);
  if (lower.endsWith(".markdown")) return path.slice(0, -9);
  return path;
}
