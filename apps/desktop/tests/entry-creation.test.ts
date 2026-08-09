import { describe, expect, test, vi } from "vite-plus/test";
import {
  executeEntryCreation,
  getEntryCreationPath,
  planEntryCreation,
  validateEntryName,
  type EntryCreationDependencies,
  type EntryCreationTarget,
} from "../src/lib/entry-creation";

function plannedTarget(
  parentDirectory: string,
  rawName: string,
  kind: "file" | "folder",
): EntryCreationTarget {
  const plan = planEntryCreation(parentDirectory, rawName, kind);
  if (!plan.ok) throw new Error(plan.error);
  return plan.target;
}

describe("planEntryCreation", () => {
  test("creates files and folders as immediate children of the parent", () => {
    const file = plannedTarget("/vault", " Draft ", "file");
    expect(file).toEqual({ kind: "file", parentDirectory: "/vault", name: "Draft.md" });
    expect(getEntryCreationPath(file)).toBe("/vault/Draft.md");

    const folder = plannedTarget("/vault/", "Archive", "folder");
    expect(folder).toEqual({ kind: "folder", parentDirectory: "/vault/", name: "Archive" });
    expect(getEntryCreationPath(folder)).toBe("/vault/Archive");

    const rootFile = plannedTarget("/", "Root note", "file");
    expect(getEntryCreationPath(rootFile)).toBe("/Root note.md");
  });

  test("normalizes an existing markdown extension case-insensitively", () => {
    expect(plannedTarget("/vault", "Draft.MD", "file").name).toBe("Draft.md");
  });

  test.each(["", "   ", ".", "..", ".hidden", "nested/file", "nested\\file"])(
    "rejects a non-basename input: %j",
    (rawName) => {
      expect(planEntryCreation("/vault", rawName, "folder").ok).toBe(false);
    },
  );
});

describe("validateEntryName", () => {
  test.each(["../Outside", "nested/file", "nested\\file", ".hidden"])(
    "rejects an unsafe inline rename: %j",
    (rawName) => {
      expect(validateEntryName(rawName, "folder").ok).toBe(false);
    },
  );
});

function makeDependencies(currentRoot: string | null = "/vault") {
  const calls: string[] = [];
  const dependencies: EntryCreationDependencies = {
    createFile: vi.fn(async (path) => {
      calls.push(`create-file:${path}`);
    }),
    createFolder: vi.fn(async (path) => {
      calls.push(`create-folder:${path}`);
    }),
    refreshDirectory: vi.fn(async (path) => {
      calls.push(`refresh:${path}`);
    }),
    openWorkspaceFile: vi.fn(async (path) => {
      calls.push(`open-workspace:${path}`);
    }),
    openStandaloneFile: vi.fn(async (path) => {
      calls.push(`open-standalone:${path}`);
    }),
    getCurrentRoot: () => currentRoot,
  };
  return { calls, dependencies };
}

describe("executeEntryCreation", () => {
  test("creates, refreshes, then opens a workspace file", async () => {
    const { calls, dependencies } = makeDependencies();
    const result = await executeEntryCreation(
      plannedTarget("/vault", "Draft", "file"),
      "workspace",
      dependencies,
    );

    expect(result.followUpFailures).toEqual([]);
    expect(calls).toEqual([
      "create-file:/vault/Draft.md",
      "refresh:/vault",
      "open-workspace:/vault/Draft.md",
    ]);
  });

  test("creates and refreshes a workspace folder without opening it", async () => {
    const { calls, dependencies } = makeDependencies();
    const result = await executeEntryCreation(
      plannedTarget("/vault", "Archive", "folder"),
      "workspace",
      dependencies,
    );

    expect(result.followUpFailures).toEqual([]);
    expect(calls).toEqual(["create-folder:/vault/Archive", "refresh:/vault"]);
  });

  test("creates and opens a standalone file through the same pipeline", async () => {
    const { calls, dependencies } = makeDependencies(null);
    const result = await executeEntryCreation(
      plannedTarget("/notes", "Draft", "file"),
      "standalone",
      dependencies,
    );

    expect(result.followUpFailures).toEqual([]);
    expect(calls).toEqual(["create-file:/notes/Draft.md", "open-standalone:/notes/Draft.md"]);
  });

  test("does not run follow-up effects when creation fails", async () => {
    const { calls, dependencies } = makeDependencies();
    vi.mocked(dependencies.createFolder).mockRejectedValueOnce(new Error("already exists"));

    await expect(
      executeEntryCreation(plannedTarget("/vault", "Archive", "folder"), "workspace", dependencies),
    ).rejects.toThrow("already exists");
    expect(calls).toEqual([]);
  });

  test("opens a created file and reports refresh failure without inviting recreation", async () => {
    const { calls, dependencies } = makeDependencies();
    const refreshError = new Error("refresh failed");
    vi.mocked(dependencies.refreshDirectory).mockImplementationOnce(async (path) => {
      calls.push(`refresh:${path}`);
      throw refreshError;
    });

    const result = await executeEntryCreation(
      plannedTarget("/vault", "Draft", "file"),
      "workspace",
      dependencies,
    );

    expect(calls).toEqual([
      "create-file:/vault/Draft.md",
      "refresh:/vault",
      "open-workspace:/vault/Draft.md",
    ]);
    expect(result.followUpFailures).toEqual([{ step: "refresh", error: refreshError }]);
  });

  test("does not refresh or open after the workspace changes", async () => {
    const { calls, dependencies } = makeDependencies("/other-vault");
    const result = await executeEntryCreation(
      plannedTarget("/vault", "Draft", "file"),
      "workspace",
      dependencies,
    );

    expect(result.followUpFailures).toEqual([]);
    expect(calls).toEqual(["create-file:/vault/Draft.md"]);
  });
});
