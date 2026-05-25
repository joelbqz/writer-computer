import { EditorView } from "@codemirror/view";
import { eventHandlersWithClass } from "../utils";

// The Checkbox WIDGET itself lives in `listExtension` (`../list/index.ts`)
// — tasks render through the same `Decoration.replace` pipeline as plain
// bullets there, so the atomic-cursor / Backspace / Enter / Tab behavior
// is identical. All that remains here is the mousedown handler that
// toggles the underlying `[ ]` ↔ `[x]` source when the user clicks the
// rendered checkbox input.
export const taskExtension = EditorView.domEventHandlers(
  eventHandlersWithClass({
    mousedown: {
      "cm-checkbox": (ev, view) => {
        const pos = view.posAtDOM(ev.target as HTMLElement);
        const change = {
          from: pos + 3,
          to: pos + 4,
          insert: (ev.target as HTMLInputElement).checked ? " " : "x", // this value is old, so the text is swap
        };
        view.dispatch({
          changes: change,
        });
        return true; // prevent default
      },
    },
  }),
);
