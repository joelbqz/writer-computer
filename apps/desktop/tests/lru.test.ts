import { describe, expect, test } from "vite-plus/test";
import { LruCache } from "../src/lib/lru";

describe("LruCache", () => {
  test("evicts the least recently used entry past the limit", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // refresh a
    cache.set("c", 3); // evicts b
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  test("clear empties the cache", () => {
    const cache = new LruCache<string>(3);
    cache.set("k", "v");
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
  });
});
