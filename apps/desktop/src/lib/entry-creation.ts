export type EntryKind = "file" | "folder";
export type EntryCreationDestination = "workspace" | "standalone";

export interface EntryCreationTarget {
  kind: EntryKind;
  parentDirectory: string;
  name: string;
}

export type EntryCreationPlan =
  | { ok: true; target: EntryCreationTarget }
  | { ok: false; error: string };

export type EntryNameValidation = { ok: true; name: string } | { ok: false; error: string };

export interface EntryCreationDependencies {
  createFile: (path: string) => Promise<unknown>;
  createFolder: (path: string) => Promise<unknown>;
  refreshDirectory: (path: string) => Promise<unknown>;
  openWorkspaceFile: (path: string) => Promise<unknown>;
  openStandaloneFile: (path: string) => Promise<unknown>;
  getCurrentRoot: () => string | null;
}

export interface EntryCreationFollowUpFailure {
  step: "refresh" | "open";
  error: unknown;
}

export interface EntryCreationResult {
  followUpFailures: EntryCreationFollowUpFailure[];
}

export function validateEntryName(rawName: string, kind: EntryKind): EntryNameValidation {
  const name = rawName.trim();
  const label = kind === "file" ? "file" : "folder";

  if (!name) {
    return { ok: false, error: `Type a ${label} name to create it.` };
  }
  if (
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    return { ok: false, error: `Use a single visible ${label} name without a path.` };
  }

  return { ok: true, name };
}

/**
 * Validate a user-entered entry name as one visible basename. The backend
 * accepts arbitrary paths, so callers must plan the target before IPC.
 */
export function planEntryCreation(
  parentDirectory: string,
  rawName: string,
  kind: EntryKind,
): EntryCreationPlan {
  const validation = validateEntryName(rawName, kind);
  if (!validation.ok) return validation;
  const trimmed = validation.name;

  const name =
    kind === "file"
      ? trimmed.toLowerCase().endsWith(".md")
        ? `${trimmed.slice(0, -3)}.md`
        : `${trimmed}.md`
      : trimmed;

  return { ok: true, target: { kind, parentDirectory, name } };
}

export function getEntryCreationPath(target: EntryCreationTarget): string {
  const separator = /[\\/]$/.test(target.parentDirectory) ? "" : "/";
  return `${target.parentDirectory}${separator}${target.name}`;
}

/**
 * Own the create operation and its follow-up UI effects. Creation failures
 * reject so the naming flow can offer a retry. Once the disk write succeeds,
 * refresh/open failures are returned separately: recreating the same entry
 * would only produce an AlreadyExists error.
 */
export async function executeEntryCreation(
  target: EntryCreationTarget,
  destination: EntryCreationDestination,
  dependencies: EntryCreationDependencies,
): Promise<EntryCreationResult> {
  if (destination === "standalone" && target.kind !== "file") {
    throw new Error("Standalone creation only supports files");
  }

  const path = getEntryCreationPath(target);
  if (target.kind === "file") {
    await dependencies.createFile(path);
  } else {
    await dependencies.createFolder(path);
  }

  const followUpFailures: EntryCreationFollowUpFailure[] = [];
  if (destination === "standalone") {
    try {
      await dependencies.openStandaloneFile(path);
    } catch (error) {
      followUpFailures.push({ step: "open", error });
    }
    return { followUpFailures };
  }

  if (dependencies.getCurrentRoot() !== target.parentDirectory) {
    return { followUpFailures };
  }

  try {
    await dependencies.refreshDirectory(target.parentDirectory);
  } catch (error) {
    followUpFailures.push({ step: "refresh", error });
  }

  if (target.kind === "file" && dependencies.getCurrentRoot() === target.parentDirectory) {
    try {
      await dependencies.openWorkspaceFile(path);
    } catch (error) {
      followUpFailures.push({ step: "open", error });
    }
  }

  return { followUpFailures };
}
