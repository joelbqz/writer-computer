import { getEditorSessionSnapshot, useEditorStore } from "@/stores/editor-store";
export type { OpenFile, Tab, SessionTab } from "@/stores/editor-store";
import type { SessionTab } from "@/stores/editor-store";
import type { ScrollAnchor } from "@/components/editor-area/editor-scroll-geometry";

export function getOpenFile(path: string) {
  return useEditorStore.getState().openFiles.get(path) ?? null;
}

export function getOpenFiles() {
  return useEditorStore.getState().openFiles;
}

export function getOpenTabs() {
  return useEditorStore.getState().tabs;
}

export function getActiveTabId() {
  return useEditorStore.getState().activeTabId;
}

export function getActiveFilePath() {
  return useEditorStore.getState().activeFilePath;
}

export function openNewTab() {
  useEditorStore.getState().openNewTab();
}

export function closeFile(path: string) {
  useEditorStore.getState().closeFile(path);
}

export function closeActiveTab() {
  useEditorStore.getState().closeActiveTab();
}

export function markSaved(path: string, diskContent: string) {
  useEditorStore.getState().markSaved(path, diskContent);
}

export function updateContent(path: string, content: string) {
  useEditorStore.getState().updateContent(path, content);
}

export function updateCursorPos(path: string, pos: number) {
  useEditorStore.getState().updateCursorPos(path, pos);
}

export function updateScrollPos(path: string, pos: number) {
  useEditorStore.getState().updateScrollPos(path, pos);
}

export function updateScrollAnchor(path: string, anchor: ScrollAnchor | null) {
  useEditorStore.getState().updateScrollAnchor(path, anchor);
}

export function updateFrontmatter(path: string, frontmatter: string | null) {
  useEditorStore.getState().updateFrontmatter(path, frontmatter);
}

export function reloadFromDisk(path: string, rawContent: string) {
  useEditorStore.getState().reloadFromDisk(path, rawContent);
}

export function navigateToFile(path: string) {
  return useEditorStore.getState().navigateToFile(path);
}

export function navigateBack() {
  return useEditorStore.getState().navigateBack();
}

export function navigateForward() {
  return useEditorStore.getState().navigateForward();
}

export function renameOpenFile(oldPath: string, newPath: string) {
  useEditorStore.getState().renameOpenFile(oldPath, newPath);
}

export function openFileInNewTab(path: string) {
  return useEditorStore.getState().openFileInNewTab(path);
}

export function removePathReferences(path: string) {
  useEditorStore.getState().removePathReferences(path);
}

export function removePathsWithPrefix(prefix: string) {
  useEditorStore.getState().removePathsWithPrefix(prefix);
}

export function rewritePathPrefix(oldPrefix: string, newPrefix: string) {
  useEditorStore.getState().rewritePathPrefix(oldPrefix, newPrefix);
}

export function restoreSession(tabs: SessionTab[], activeIndex: number | null) {
  return useEditorStore.getState().restoreSession(tabs, activeIndex);
}

export function getCursorScroll(path: string) {
  const file = useEditorStore.getState().openFiles.get(path);
  return { cursorPos: file?.cursorPos ?? 0, scrollPos: file?.scrollPos ?? 0 };
}

export function getSessionSnapshot() {
  const state = useEditorStore.getState();
  return getEditorSessionSnapshot(state);
}
