import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { eventHandlersWithClass, iterChildren } from "./utils";
import { markdownTags } from "./markdown/tags";
import { Facet } from "@codemirror/state";

function getUrlFromLink(view: EditorView, pos: number): string | undefined {
  const tree = syntaxTree(view.state);

  let url: string | undefined;

  tree.iterate({
    to: pos,
    from: pos,
    enter(node) {
      if (node.name !== "Link") return;

      iterChildren(node.node.cursor(), (cursor) => {
        if (cursor.name === "URL") {
          url = view.state.doc.sliceString(cursor.from, cursor.to);
          return true;
        }
      });
      return true;
    },
  });

  return url;
}

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

        const url = getUrlFromLink(view, pos);
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

const getRawUrl = (view: EditorView, pos: number): string | undefined => {
  const tree = syntaxTree(view.state);

  let url: string | undefined;

  tree.iterate({
    to: pos,
    from: pos,
    enter(node) {
      if (node.name !== "URL") return;
      if (node.node.parent?.name === "Link") return;

      url = view.state.doc.sliceString(node.from, node.to);
      return true;
    },
  });

  return url;
};

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

        const url = getRawUrl(view, pos);
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
