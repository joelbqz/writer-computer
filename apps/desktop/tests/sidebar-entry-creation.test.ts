import { describe, expect, test, vi } from "vite-plus/test";
import { createUntitledSidebarEntry } from "../src/components/sidebar/sidebar-entry-creation";

function makeDependencies(calls: string[]) {
  return {
    fileExists: vi.fn(async () => false),
    createFile: vi.fn(async (path: string) => {
      calls.push(`create-file:${path}`);
    }),
    createFolder: vi.fn(async (path: string) => {
      calls.push(`create-folder:${path}`);
    }),
    isCurrent: () => true,
    revealEntry: vi.fn(async (path: string) => {
      calls.push(`reveal:${path}`);
    }),
    beginRenaming: vi.fn((path: string) => calls.push(`rename:${path}`)),
  };
}

describe("createUntitledSidebarEntry", () => {
  test.each([
    ["file", "/vault/Untitled.md", "create-file:/vault/Untitled.md"],
    ["folder", "/vault/Untitled Folder", "create-folder:/vault/Untitled Folder"],
  ] as const)("creates, reveals, and begins renaming an untitled %s", async (kind, path, call) => {
    const calls: string[] = [];
    const result = await createUntitledSidebarEntry("/vault", kind, makeDependencies(calls));

    expect(result).toEqual({ path });
    expect(calls).toEqual([call, `reveal:${path}`, `rename:${path}`]);
  });

  test("increments the default name until it is available", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    dependencies.fileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await createUntitledSidebarEntry("/vault", "file", dependencies);

    expect(result.path).toBe("/vault/Untitled 3.md");
    expect(dependencies.createFile).toHaveBeenCalledWith("/vault/Untitled 3.md");
  });

  test("does not duplicate a workspace root separator", async () => {
    const dependencies = makeDependencies([]);

    const result = await createUntitledSidebarEntry("/", "file", dependencies);

    expect(result.path).toBe("/Untitled.md");
    expect(dependencies.createFile).toHaveBeenCalledWith("/Untitled.md");
  });

  test("does not create when no available default name can be found", async () => {
    const dependencies = makeDependencies([]);
    dependencies.fileExists.mockResolvedValue(true);

    await expect(createUntitledSidebarEntry("/vault", "file", dependencies)).rejects.toThrow(
      'Could not find an available name for "Untitled" in /vault',
    );
    expect(dependencies.createFile).not.toHaveBeenCalled();
  });

  test("does not reveal or rename after the workspace changes", async () => {
    const dependencies = makeDependencies([]);
    dependencies.isCurrent = () => false;

    await createUntitledSidebarEntry("/vault", "file", dependencies);

    expect(dependencies.revealEntry).not.toHaveBeenCalled();
    expect(dependencies.beginRenaming).not.toHaveBeenCalled();
  });

  test("reports a reveal failure after creation without starting rename", async () => {
    const dependencies = makeDependencies([]);
    const followUpFailure = new Error("refresh failed");
    dependencies.revealEntry.mockRejectedValue(followUpFailure);

    const result = await createUntitledSidebarEntry("/vault", "file", dependencies);

    expect(result).toEqual({ path: "/vault/Untitled.md", followUpFailure });
    expect(dependencies.beginRenaming).not.toHaveBeenCalled();
  });

  test("does not rename when the workspace changes during reveal", async () => {
    const dependencies = makeDependencies([]);
    let isCurrent = true;
    dependencies.isCurrent = () => isCurrent;
    dependencies.revealEntry.mockImplementationOnce(async () => {
      isCurrent = false;
    });

    await createUntitledSidebarEntry("/vault", "folder", dependencies);

    expect(dependencies.revealEntry).toHaveBeenCalledOnce();
    expect(dependencies.beginRenaming).not.toHaveBeenCalled();
  });
});
