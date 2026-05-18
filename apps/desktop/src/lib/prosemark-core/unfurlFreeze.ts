import { Facet } from "@codemirror/state";

/**
 * When any provider contributes `true`, prosemark's `hideExtension` and
 * `foldExtension` skip selection-driven rebuilds — decorations stay frozen in
 * their last computed shape. Doc changes still re-map positions so the
 * decoration set stays coordinate-valid; only the selection-touch
 * recomputation is suppressed.
 *
 * Intended for pointer drag gating: freeze unfurl/hide decisions between
 * pointerdown and pointerup so text doesn't reflow under the cursor.
 */
export const unfurlFreezeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});
