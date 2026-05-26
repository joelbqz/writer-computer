export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot <= lastSlash + 1) return "";
  return path.slice(lastDot + 1);
}

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const EXPLICIT_URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const MARKDOWN_ESCAPABLE = new Set(`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~ \t`.split(""));

export type LinkTarget =
  | { kind: "internal"; path: string; anchor?: string }
  | { kind: "same-doc-anchor"; anchor: string }
  | { kind: "external-url"; url: string }
  | { kind: "external-path"; path: string };

function splitLinkHref(href: string): string {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const splitIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex);
  return splitIndex === -1 ? href : href.slice(0, splitIndex);
}

function extractAnchor(href: string): string | undefined {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return undefined;
  const anchor = href.slice(hashIndex + 1);
  return anchor ? decodeLinkPath(anchor) : undefined;
}

export function decodeLinkPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function unescapeMarkdownDestination(path: string): string {
  let result = "";
  for (let index = 0; index < path.length; index++) {
    const char = path[index]!;
    const next = path[index + 1];
    if (char === "\\" && next && MARKDOWN_ESCAPABLE.has(next)) {
      result += next;
      index++;
      continue;
    }
    result += char;
  }
  return result;
}

export function normalizeMarkdownDestination(destination: string): string {
  let normalized = destination.trim();
  if (normalized.startsWith("<") && normalized.endsWith(">")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return unescapeMarkdownDestination(normalized);
}

export function normalizeLocalMarkdownDestination(destination: string): string {
  return decodeLinkPath(normalizeMarkdownDestination(destination));
}

export function formatMarkdownDestination(destination: string): string {
  if (!/[\s<>]/.test(destination)) return destination;
  const escaped = destination.replace(/</g, "%3C").replace(/>/g, "%3E");
  return `<${escaped}>`;
}

export function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const isWindowsAbsolute = WINDOWS_ABSOLUTE_PATH.test(normalized);
  const hasLeadingSlash = normalized.startsWith("/");
  const parts = normalized.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      const last = stack[stack.length - 1];
      if (last && last !== "..") {
        if (isWindowsAbsolute || hasLeadingSlash || !WINDOWS_ABSOLUTE_PATH.test(last)) {
          stack.pop();
          continue;
        }
      }
      if (!isWindowsAbsolute && !hasLeadingSlash) stack.push(part);
      continue;
    }
    stack.push(part);
  }

  if (isWindowsAbsolute) {
    const [drive, ...rest] = stack;
    return rest.length === 0 ? `${drive}/` : `${drive}/${rest.join("/")}`;
  }

  if (hasLeadingSlash) {
    return stack.length === 0 ? "/" : `/${stack.join("/")}`;
  }

  return stack.join("/");
}

function resolvePath(baseDir: string, target: string): string {
  if (WINDOWS_ABSOLUTE_PATH.test(target) || target.startsWith("/")) {
    return normalizePath(target);
  }
  return normalizePath(`${baseDir.replace(/\/$/, "")}/${target}`);
}

function isPathInsideRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export type FileExistsFn = (path: string) => boolean | Promise<boolean>;

export async function resolveLinkTarget(
  href: string,
  currentFilePath: string,
  workspaceRoot?: string | null,
  fileExists?: FileExistsFn,
): Promise<LinkTarget | null> {
  const trimmed = normalizeMarkdownDestination(href);
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) {
    const anchor = extractAnchor(trimmed);
    return anchor ? { kind: "same-doc-anchor", anchor } : null;
  }
  if (EXPLICIT_URL_SCHEME.test(trimmed) && !WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
    return { kind: "external-url", url: trimmed };
  }

  const target = splitLinkHref(trimmed);
  if (!target) return null;

  const anchor = extractAnchor(trimmed);
  const decodedTarget = decodeLinkPath(target);
  const resolvedPath = resolvePath(getParentDir(currentFilePath), decodedTarget);

  const extension = getFileExtension(resolvedPath).toLowerCase();
  const isMarkdown = extension === "md" || extension === "markdown";

  if (isMarkdown && (!workspaceRoot || isPathInsideRoot(resolvedPath, workspaceRoot))) {
    return { kind: "internal", path: resolvedPath, ...(anchor ? { anchor } : {}) };
  }

  // Probe for markdown files when the resolved path has no recognized extension.
  // For doc-corpus conventions (Hugo, Docusaurus, MDN, …), extensionless
  // absolute paths like `/docs/foo/bar/` are site-root-relative, so we probe
  // both their workspace-root mapping and their filesystem mapping.
  if (extension === "" && fileExists) {
    const bases: string[] = [resolvedPath.replace(/\/+$/, "")];
    const isPosixAbsolute =
      decodedTarget.startsWith("/") && !WINDOWS_ABSOLUTE_PATH.test(decodedTarget);
    if (isPosixAbsolute && workspaceRoot) {
      const rootRelative = normalizePath(
        `${workspaceRoot.replace(/\/$/, "")}${decodedTarget}`,
      ).replace(/\/+$/, "");
      if (!bases.includes(rootRelative)) bases.push(rootRelative);
    }

    for (const base of bases) {
      const candidates = [
        `${base}.md`,
        `${base}.markdown`,
        `${base}/index.md`,
        `${base}/index.markdown`,
        `${base}/README.md`,
      ];
      for (const candidate of candidates) {
        if (workspaceRoot && !isPathInsideRoot(candidate, workspaceRoot)) continue;
        if (await fileExists(candidate)) {
          return { kind: "internal", path: candidate, ...(anchor ? { anchor } : {}) };
        }
      }
    }
  }

  return { kind: "external-path", path: resolvedPath };
}

export function getFileStem(path: string): string {
  const name = getFileName(path);
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return name;
  return name.slice(0, lastDot);
}

export function getFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(lastSlash + 1);
}

export function getRelativePath(fullPath: string, root: string): string {
  const normalized = fullPath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(normalizedRoot + "/")) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

export function getParentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

export function resolveImagePath(imageSrc: string, markdownDir: string): string {
  const normalizedSrc = normalizeMarkdownDestination(imageSrc);
  if (normalizedSrc.startsWith("http://") || normalizedSrc.startsWith("https://")) {
    return normalizedSrc;
  }
  const localSrc = decodeLinkPath(normalizedSrc);
  if (localSrc.startsWith("/")) return localSrc;
  return `${markdownDir.replace(/\/$/, "")}/${localSrc}`;
}
