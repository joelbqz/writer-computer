import { SETTINGS_SCHEMA } from "./settings-schema";

/** Editor text zoom, stored as a percent so the Preferences range control
 *  renders it without decimals and the schema's `min`/`max` own the clamp.
 *  The schema binds it to `--writer-editor-zoom`; `App.css` multiplies it
 *  into `--writer-editor-font-size` on top of the Font Size setting, so the
 *  editor scales while the rest of the UI stays put. */
export const ZOOM_SETTING_KEY = "editor.zoom" as const;

/** Stops that Cmd+= / Cmd+- walk through, in percent. Mirrors the browser
 *  ladder so a presenter gets the familiar 110 → 125 → 150 progression. The
 *  ends must equal the schema bounds; `tests/zoom.test.ts` asserts it. */
export const ZOOM_STEPS: readonly number[] = [
  50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300,
];

const zoomDef = SETTINGS_SCHEMA.find((def) => def.key === ZOOM_SETTING_KEY);
if (
  !zoomDef ||
  typeof zoomDef.min !== "number" ||
  typeof zoomDef.max !== "number" ||
  typeof zoomDef.default !== "number"
) {
  throw new Error(`settings schema is missing a numeric range entry for ${ZOOM_SETTING_KEY}`);
}

export const ZOOM_MIN: number = zoomDef.min;
export const ZOOM_MAX: number = zoomDef.max;
export const DEFAULT_ZOOM: number = zoomDef.default;

/** Coerce a stored value to a percent inside the schema bounds. Anything
 *  that is not a finite number (unset, hand-edited garbage) reads as the
 *  default so stepping always has a sane origin. */
export function normalizeZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Next stop strictly above the current value, clamped at the top. */
export function zoomInFrom(current: unknown): number {
  const percent = normalizeZoom(current);
  return ZOOM_STEPS.find((stop) => stop > percent) ?? ZOOM_MAX;
}

/** Next stop strictly below the current value, clamped at the bottom. */
export function zoomOutFrom(current: unknown): number {
  const percent = normalizeZoom(current);
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const stop = ZOOM_STEPS[i]!;
    if (stop < percent) return stop;
  }
  return ZOOM_MIN;
}
