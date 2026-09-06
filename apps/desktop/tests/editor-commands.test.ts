import { describe, expect, test } from "vite-plus/test";
import {
  chordToAccelerator,
  editorCommands,
} from "../src/components/editor-area/markdown-formatting";

describe("chordToAccelerator", () => {
  test("maps CodeMirror chords to Tauri accelerator syntax", () => {
    expect(chordToAccelerator("Mod-b")).toBe("CmdOrCtrl+B");
    expect(chordToAccelerator("Mod-Shift-x")).toBe("CmdOrCtrl+Shift+X");
    expect(chordToAccelerator("Mod-Alt-1")).toBe("CmdOrCtrl+Alt+1");
    expect(chordToAccelerator("Mod-Shift-.")).toBe("CmdOrCtrl+Shift+.");
    expect(chordToAccelerator("Mod-Shift-Enter")).toBe("CmdOrCtrl+Shift+Enter");
  });
});

describe("editorCommands registry", () => {
  test("chords are unique", () => {
    const chords = Object.values(editorCommands).flatMap((c) => ("chord" in c ? [c.chord] : []));
    expect(new Set(chords).size).toBe(chords.length);
  });

  test("every command has a label", () => {
    for (const [id, command] of Object.entries(editorCommands)) {
      expect(command.label, id).not.toBe("");
    }
  });
});
