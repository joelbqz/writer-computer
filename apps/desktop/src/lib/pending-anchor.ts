// Carries a heading slug across the gap between `navigateToFile` (which
// triggers an async load + an editor swap) and the editor's first render
// of the new document. Keyed by absolute file path. Consumed exactly once.

const pending = new Map<string, string>();

export function setPendingAnchor(path: string, anchor: string): void {
  pending.set(path, anchor);
}

export function consumePendingAnchor(path: string): string | undefined {
  const anchor = pending.get(path);
  if (anchor !== undefined) pending.delete(path);
  return anchor;
}

export function clearPendingAnchor(path: string): void {
  pending.delete(path);
}
