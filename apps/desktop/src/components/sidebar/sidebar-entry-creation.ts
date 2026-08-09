export type SidebarEntryKind = "file" | "folder";

interface SidebarEntryCreationDependencies {
  fileExists: (path: string) => Promise<boolean>;
  createFile: (path: string) => Promise<unknown>;
  createFolder: (path: string) => Promise<unknown>;
  isCurrent: () => boolean;
  revealEntry: (path: string) => Promise<unknown>;
  beginRenaming: (path: string) => void;
}

interface SidebarEntryCreationResult {
  path: string;
  followUpFailure?: unknown;
}

export function getSidebarCreationErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? "Unknown error";
}

export async function resolveUniqueEntryPath(
  parentPath: string,
  baseName: string,
  extension: string,
  fileExists: (path: string) => Promise<boolean>,
): Promise<string> {
  const separator = /[\\/]$/.test(parentPath) ? "" : "/";
  const first = `${parentPath}${separator}${baseName}${extension}`;
  if (!(await fileExists(first))) return first;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${parentPath}${separator}${baseName} ${n}${extension}`;
    if (!(await fileExists(candidate))) return candidate;
  }

  throw new Error(`Could not find an available name for "${baseName}" in ${parentPath}`);
}

/**
 * Create the next available untitled entry, reveal it in the current tree,
 * and begin inline rename. Creation failures reject; a post-create reveal
 * failure is returned separately so callers never report a successful write
 * as a failed creation.
 */
export async function createUntitledSidebarEntry(
  parentPath: string,
  kind: SidebarEntryKind,
  dependencies: SidebarEntryCreationDependencies,
): Promise<SidebarEntryCreationResult> {
  const isFile = kind === "file";
  const path = await resolveUniqueEntryPath(
    parentPath,
    isFile ? "Untitled" : "Untitled Folder",
    isFile ? ".md" : "",
    dependencies.fileExists,
  );

  if (isFile) {
    await dependencies.createFile(path);
  } else {
    await dependencies.createFolder(path);
  }
  if (!dependencies.isCurrent()) return { path };

  try {
    await dependencies.revealEntry(path);
  } catch (followUpFailure) {
    return dependencies.isCurrent() ? { path, followUpFailure } : { path };
  }
  if (dependencies.isCurrent()) dependencies.beginRenaming(path);
  return { path };
}
