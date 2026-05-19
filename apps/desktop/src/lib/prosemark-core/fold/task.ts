import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./core";
import { eventHandlersWithClass } from "../utils";

class Checkbox extends WidgetType {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }

  eq(other: Checkbox): boolean {
    return this.value === other.value;
  }

  toDOM() {
    // Wrapper carries an invisible copy of the raw 5 chars (`- [ ]`) so its
    // inline width matches the raw text exactly. The visual checkbox is
    // absolutely positioned on top so the column where body text starts
    // doesn't shift when the caret toggles between rendered and raw.
    const wrapper = document.createElement("span");
    wrapper.className = "cm-checkbox-wrapper";

    const spacer = document.createElement("span");
    spacer.className = "cm-checkbox-spacer";
    spacer.textContent = "- [ ]";
    wrapper.appendChild(spacer);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-checkbox";
    input.checked = this.value;
    wrapper.appendChild(input);

    return wrapper;
  }

  ignoreEvent(_event: Event) {
    return false;
  }
}

export const taskExtension = [
  foldableSyntaxFacet.of({
    nodePath: "BulletList/ListItem/Task/TaskMarker",
    buildDecorations: (state, node) => {
      const value = state.doc.sliceString(node.from + 1, node.to - 1).toLowerCase() === "x";
      return Decoration.replace({
        widget: new Checkbox(value),
      }).range(node.from - 2, node.to);
    },
    unfoldZone: (_state, node) => ({
      from: node.from - 2,
      to: node.to,
    }),
  }),
  EditorView.domEventHandlers(
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
  ),
];
