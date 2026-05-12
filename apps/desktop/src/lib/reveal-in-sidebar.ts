import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface RevealOptions {
  /** If the sidebar is currently hidden, flip the setting back on before
   *  scrolling. Used by the explicit "Reveal in sidebar" menu action; the
   *  auto-reveal hook leaves it off so collapsed sidebars stay collapsed. */
  showSidebar?: boolean;
}

const FRAME_BUDGET = 5;

let latestToken = 0;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function ancestorsBetween(root: string, leaf: string): string[] {
  const prefix = `${root}/`;
  if (!leaf.startsWith(prefix)) return [];
  const relative = leaf.slice(prefix.length);
  const segments = relative.split("/");
  segments.pop();
  const ancestors: string[] = [];
  let accum = root;
  for (const seg of segments) {
    accum = `${accum}/${seg}`;
    ancestors.push(accum);
  }
  return ancestors;
}

async function waitForRow(path: string): Promise<HTMLElement | null> {
  const selector = `[data-tree-path="${CSS.escape(path)}"]`;
  for (let i = 0; i < FRAME_BUDGET; i += 1) {
    const row = document.querySelector<HTMLElement>(selector);
    if (row) return row;
    await nextFrame();
  }
  return document.querySelector<HTMLElement>(selector);
}

/**
 * Make `path`'s row visible in the sidebar tree: expand every ancestor folder
 * from the workspace root down to the file's parent, then scroll the row into
 * view. The single coordinator for revealing a file — auto-reveal on file
 * open and the explicit tab-context-menu action both go through here.
 *
 * No-op when the workspace isn't open or the path lives outside the
 * workspace root. Concurrent calls cancel earlier ones via a module-level
 * token so back/forward held down doesn't scroll to a stale leaf.
 */
export async function revealPathInSidebar(path: string, opts: RevealOptions = {}): Promise<void> {
  const token = ++latestToken;

  if (opts.showSidebar) {
    const settings = useSettingsStore.getState();
    const isVisible = settings.settings["appearance.sidebar-visible"] !== false;
    if (!isVisible) {
      await settings.setSetting("appearance.sidebar-visible", true);
      if (token !== latestToken) return;
    }
  }

  const { root } = useWorkspaceStore.getState();
  if (!root) return;
  if (path === root) return;
  if (!path.startsWith(`${root}/`)) return;

  for (const ancestor of ancestorsBetween(root, path)) {
    const { expandedDirs, toggleDirectory } = useWorkspaceStore.getState();
    if (expandedDirs.has(ancestor)) continue;
    await toggleDirectory(ancestor);
    if (token !== latestToken) return;
  }

  await nextFrame();
  if (token !== latestToken) return;

  const row = await waitForRow(path);
  if (token !== latestToken) return;
  row?.scrollIntoView({ behavior: "auto", block: "nearest" });
}
