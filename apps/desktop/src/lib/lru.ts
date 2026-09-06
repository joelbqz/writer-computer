/** Small bounded most-recently-used cache. A `get` refreshes recency; once
 *  `limit` is exceeded the least recently used entry is evicted. Shared by the
 *  mermaid, math, and HTML-block renderers so widgets can paint synchronously
 *  in `toDOM` with repeat renders costing a map lookup (see docs/editor.md). */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
