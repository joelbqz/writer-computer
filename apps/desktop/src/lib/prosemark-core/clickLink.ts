import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { eventHandlersWithClass } from "./utils";
import { markdownTags } from "./markdown/tags";
import { Facet } from "@codemirror/state";
import { linkUrlAt, rawUrlAt } from "./links";

export type ClickLinkHandler = (link: string) => void;

export const clickLinkHandler = Facet.define<ClickLinkHandler>();

export const defaultClickLinkHandler = clickLinkHandler.of((url) => {
  window.open(url, "_blank");
});

const clickFullLinkExtension = EditorView.domEventHandlers(
  eventHandlersWithClass({
    mousedown: {
      "cm-rendered-link": (e: MouseEvent, view: EditorView) => {
        const pos = view.posAtCoords(e);
        if (pos === null) {
          return;
        }

        const url = linkUrlAt(view.state, pos);
        if (!url) {
          return;
        }

        view.state.facet(clickLinkHandler).map((handler) => {
          handler(url);
        });
      },
    },
  }),
);

const addClassToUrl = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: markdownTags.linkURL,
      class: "cm-url", // needed for click event
    },
  ]),
);

const clickRawUrlExtension = EditorView.domEventHandlers(
  eventHandlersWithClass({
    mousedown: {
      "cm-url": (e: MouseEvent, view: EditorView) => {
        const pos = view.posAtCoords(e);
        if (pos === null) {
          return;
        }

        const url = rawUrlAt(view.state, pos);
        if (!url) {
          return;
        }

        view.state.facet(clickLinkHandler).map((handler) => {
          handler(url);
        });
      },
    },
  }),
);

export const clickLinkExtension = [clickFullLinkExtension, addClassToUrl, clickRawUrlExtension];
