import { describe, expect, test, vi } from "vite-plus/test";
import { runCreateRequest } from "../src/components/command-palette/run-create-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("runCreateRequest", () => {
  test("ignores success after a new palette session opens", async () => {
    const pending = deferred<string>();
    let currentSession = 1;
    const onCreated = vi.fn();
    const onCreationError = vi.fn();
    const request = runCreateRequest({
      create: () => pending.promise,
      isCurrent: () => currentSession === 1,
      onCreated,
      onCreationError,
    });

    currentSession = 2;
    pending.resolve("created");
    await request;

    expect(onCreated).not.toHaveBeenCalled();
    expect(onCreationError).not.toHaveBeenCalled();
  });

  test("ignores failure after a new palette session opens", async () => {
    const pending = deferred<string>();
    let currentSession = 1;
    const onCreated = vi.fn();
    const onCreationError = vi.fn();
    const request = runCreateRequest({
      create: () => pending.promise,
      isCurrent: () => currentSession === 1,
      onCreated,
      onCreationError,
    });

    currentSession = 2;
    pending.reject(new Error("stale failure"));
    await request;

    expect(onCreated).not.toHaveBeenCalled();
    expect(onCreationError).not.toHaveBeenCalled();
  });
});
