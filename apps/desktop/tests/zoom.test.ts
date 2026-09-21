import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/theme", () => ({ applyTheme: vi.fn(), applyCssVarBindings: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { applyCssVarBindings } from "../src/lib/theme";
import { SETTINGS_SCHEMA } from "../src/lib/settings-schema";
import {
  DEFAULT_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SETTING_KEY,
  ZOOM_STEPS,
  normalizeZoom,
  zoomInFrom,
  zoomOutFrom,
} from "../src/lib/zoom";
import { resetZoom, zoomIn, zoomOut } from "../src/hooks/zoom-api";
import { useSettingsStore } from "../src/stores/settings-store";

const mockedInvoke = vi.mocked(invoke);
const mockedApplyCssVarBindings = vi.mocked(applyCssVarBindings);

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("editor.zoom setting contract", () => {
  test("is a global percent range under Editor bound to the zoom CSS variable", () => {
    const definition = SETTINGS_SCHEMA.find((def) => def.key === ZOOM_SETTING_KEY);
    expect(definition).toMatchObject({
      label: "Zoom",
      category: "Editor",
      type: "range",
      min: 50,
      max: 300,
      step: 5,
      scope: "global",
      cssVar: "--writer-editor-zoom",
      default: 100,
    });
    expect(definition).not.toHaveProperty("cssFormat");
  });

  test("leaves the font-size setting bound to the base variable that zoom multiplies", () => {
    const fontSize = SETTINGS_SCHEMA.find((def) => def.key === "editor.font-size");
    expect(fontSize).toMatchObject({
      cssVar: "--writer-editor-base-font-size",
      cssFormat: "px",
    });
  });

  test("step ladder spans exactly the schema bounds and passes through the default", () => {
    expect(ZOOM_STEPS[0]).toBe(ZOOM_MIN);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(ZOOM_MAX);
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM);
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual(ZOOM_STEPS);
  });
});

describe("zoom stepping", () => {
  test("walks the ladder one stop at a time in both directions", () => {
    expect(zoomInFrom(100)).toBe(110);
    expect(zoomInFrom(110)).toBe(125);
    expect(zoomOutFrom(100)).toBe(90);
    expect(zoomOutFrom(125)).toBe(110);
  });

  test("clamps at the ends", () => {
    expect(zoomInFrom(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomOutFrom(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(zoomInFrom(1000)).toBe(ZOOM_MAX);
    expect(zoomOutFrom(1)).toBe(ZOOM_MIN);
  });

  test("snaps off-ladder values to the next stop in the travel direction", () => {
    expect(zoomInFrom(120)).toBe(125);
    expect(zoomOutFrom(120)).toBe(110);
    expect(zoomInFrom(299)).toBe(300);
  });

  test("treats unset or invalid values as the default", () => {
    expect(normalizeZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom("150")).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
    expect(zoomInFrom(undefined)).toBe(110);
    expect(zoomOutFrom(undefined)).toBe(90);
  });
});

describe("zoom actions through the settings store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockImplementation((_command, args) =>
      Promise.resolve((args as { value?: unknown } | undefined)?.value ?? null),
    );
  });

  test("write editor.zoom only and re-run the CSS variable bindings", async () => {
    useSettingsStore.setState({
      settings: { [ZOOM_SETTING_KEY]: 100, "editor.font-size": 16 },
      isLoaded: true,
    });

    zoomIn();
    let settings = useSettingsStore.getState().settings;
    expect(settings[ZOOM_SETTING_KEY]).toBe(110);
    expect(settings["editor.font-size"]).toBe(16);
    expect(mockedApplyCssVarBindings).toHaveBeenLastCalledWith(settings);
    // The disk write is queued behind the per-key lane's promise chain.
    await flushMicrotasks();
    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: ZOOM_SETTING_KEY,
      value: 110,
      scope: "global",
    });

    zoomOut();
    zoomOut();
    expect(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]).toBe(90);

    resetZoom();
    settings = useSettingsStore.getState().settings;
    expect(settings[ZOOM_SETTING_KEY]).toBe(DEFAULT_ZOOM);
    expect(settings["editor.font-size"]).toBe(16);
    await flushMicrotasks();
  });

  test("do not write when already at a bound", async () => {
    useSettingsStore.setState({ settings: { [ZOOM_SETTING_KEY]: ZOOM_MAX }, isLoaded: true });
    mockedInvoke.mockClear();
    zoomIn();
    await flushMicrotasks();
    expect(mockedInvoke).not.toHaveBeenCalledWith("set_setting", expect.anything());
  });
});
