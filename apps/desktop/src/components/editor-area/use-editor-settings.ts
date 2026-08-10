import { useCallback } from "react";
import { useSetting } from "@/hooks/use-settings";

/** Editor-scoped settings that don't fit the generic `cssVar` binding flow.
 *  CSS-var-driven settings (font-size, line-height, …) declare their var in
 *  the JSON schema and get pushed to :root by `applyCssVarBindings`. This
 *  hook only handles values that need conversion before becoming CSS. */
export function useEditorSettingsRef() {
  const editorWidth = useSetting("appearance.editor-width");

  return useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      el.style.setProperty("--writer-editor-max-width", editorWidth === "full" ? "100%" : "720px");

      // Publish the pane width so content that may break out of the measure
      // (rendered tables) knows how much room there actually is. Inside the
      // editor every percentage resolves against the measure — `.cm-content` is
      // the width-capped box — so this cannot be done in CSS without making an
      // ancestor of the CodeMirror DOM a query container, which would also make
      // it the containing block for CM's fixed-position tooltips. Until the
      // first observation lands the var is unset and the break-out width in
      // `table-decorations.ts` falls back to the measure, so nothing overhangs
      // unmeasured.
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(([entry]) => {
        el.style.setProperty("--writer-editor-pane-width", `${entry.contentRect.width}px`);
      });
      observer.observe(el);
      return () => observer.disconnect();
    },
    [editorWidth],
  );
}
