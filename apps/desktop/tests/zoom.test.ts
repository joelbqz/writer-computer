import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/theme", () => ({ applyTheme: vi.fn(), applyCssVarBindings: vi.fn() }));

const setZoom = vi.fn<(scale: number) => Promise<void>>();
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

import { invoke } from "@tauri-apps/api/core";
import { SETTINGS_SCHEMA } from "../src/lib/settings-schema";
import {
  DEFAULT_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SETTING_KEY,
  ZOOM_STEPS,
  applyWindowZoom,
  normalizeZoom,
  zoomInFrom,
  zoomOutFrom,
} from "../src/lib/zoom";
import { resetZoom, zoomIn, zoomOut } from "../src/hooks/zoom-api";
import { useSettingsStore } from "../src/stores/settings-store";

const mockedInvoke = vi.mocked(invoke);

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("window.zoom setting contract", () => {
  test("is a global percent range under Window", () => {
    const definition = SETTINGS_SCHEMA.find((def) => def.key === ZOOM_SETTING_KEY);
    expect(definition).toMatchObject({
      label: "Zoom",
      category: "Window",
      type: "range",
      min: 50,
      max: 300,
      step: 5,
      scope: "global",
      default: 100,
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

describe("applying zoom to the webview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setZoom.mockResolvedValue(undefined);
    mockedInvoke.mockImplementation((_command, args) =>
      Promise.resolve((args as { value?: unknown } | undefined)?.value ?? null),
    );
    // Start every test from a known applied state.
    applyWindowZoom(100);
    setZoom.mockClear();
  });

  test("skips absent values and dedupes repeats", () => {
    applyWindowZoom(undefined);
    applyWindowZoom(100);
    expect(setZoom).not.toHaveBeenCalled();

    applyWindowZoom(125);
    applyWindowZoom(125);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(1.25);
  });

  test("clamps out-of-range values before sending them", () => {
    applyWindowZoom(5000);
    expect(setZoom).toHaveBeenCalledWith(ZOOM_MAX / 100);
  });

  test("shortcut actions write the setting and reach the webview through the store", async () => {
    useSettingsStore.setState({ settings: { [ZOOM_SETTING_KEY]: 100 }, isLoaded: true });

    zoomIn();
    expect(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]).toBe(110);
    expect(setZoom).toHaveBeenLastCalledWith(1.1);
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
    expect(setZoom).toHaveBeenLastCalledWith(0.9);

    resetZoom();
    expect(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]).toBe(DEFAULT_ZOOM);
    expect(setZoom).toHaveBeenLastCalledWith(1);
    await flushMicrotasks();
  });

  test("does not write when already at a bound", async () => {
    useSettingsStore.setState({ settings: { [ZOOM_SETTING_KEY]: ZOOM_MAX }, isLoaded: true });
    mockedInvoke.mockClear();
    zoomIn();
    await flushMicrotasks();
    expect(mockedInvoke).not.toHaveBeenCalledWith("set_setting", expect.anything());
  });
});
