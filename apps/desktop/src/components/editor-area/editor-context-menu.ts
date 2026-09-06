import { Menu } from "@tauri-apps/api/menu/menu";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  detectPlatform,
  revealLabelForPlatform,
  type Platform,
} from "@/components/sidebar/context-menu-utils";

// -- Editor body menu --

export type EditorBodyMenuActionId =
  | "cut"
  | "copy"
  | "paste"
  | "select-all"
  | "open-link"
  | "copy-link";

export interface EditorBodyMenuHandlers {
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onOpenLink?: () => void;
  onCopyLink?: () => void;
  onRunCommand?: (id: string) => void;
}

export function buildEditorBodyMenuItemsSpec(
  handlers: EditorBodyMenuHandlers,
  hasLink: boolean,
): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    { kind: "item", id: "cut", text: "Cut", action: handlers.onCut },
    { kind: "item", id: "copy", text: "Copy", action: handlers.onCopy },
    { kind: "item", id: "paste", text: "Paste", action: handlers.onPaste },
  ];

  if (handlers.onRunCommand) {
    const run = handlers.onRunCommand;
    items.push({ kind: "separator" });
    items.push({
      kind: "submenu",
      text: "Format",
      items: [
        {
          kind: "item",
          id: "fmt.bold",
          text: "Bold",
          accelerator: "CmdOrCtrl+B",
          action: () => run("format.bold"),
        },
        {
          kind: "item",
          id: "fmt.italic",
          text: "Italic",
          accelerator: "CmdOrCtrl+I",
          action: () => run("format.italic"),
        },
        {
          kind: "item",
          id: "fmt.strikethrough",
          text: "Strikethrough",
          accelerator: "CmdOrCtrl+Shift+X",
          action: () => run("format.strikethrough"),
        },
        {
          kind: "item",
          id: "fmt.code",
          text: "Inline code",
          accelerator: "CmdOrCtrl+E",
          action: () => run("format.code"),
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "fmt.link",
          text: "Insert link\u2026",
          accelerator: "CmdOrCtrl+K",
          action: () => run("format.link"),
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "fmt.clear",
          text: "Clear formatting",
          action: () => run("clearInlineFormatting"),
        },
      ],
    });
    items.push({
      kind: "submenu",
      text: "Paragraph",
      items: [
        {
          kind: "item",
          id: "para.h1",
          text: "Heading 1",
          accelerator: "CmdOrCtrl+Alt+1",
          action: () => run("format.heading1"),
        },
        {
          kind: "item",
          id: "para.h2",
          text: "Heading 2",
          accelerator: "CmdOrCtrl+Alt+2",
          action: () => run("format.heading2"),
        },
        {
          kind: "item",
          id: "para.h3",
          text: "Heading 3",
          accelerator: "CmdOrCtrl+Alt+3",
          action: () => run("format.heading3"),
        },
        {
          kind: "item",
          id: "para.h4",
          text: "Heading 4",
          accelerator: "CmdOrCtrl+Alt+4",
          action: () => run("format.heading4"),
        },
        {
          kind: "item",
          id: "para.h5",
          text: "Heading 5",
          accelerator: "CmdOrCtrl+Alt+5",
          action: () => run("format.heading5"),
        },
        {
          kind: "item",
          id: "para.h6",
          text: "Heading 6",
          accelerator: "CmdOrCtrl+Alt+6",
          action: () => run("format.heading6"),
        },
        {
          kind: "item",
          id: "para.paragraph",
          text: "Paragraph",
          accelerator: "CmdOrCtrl+Alt+0",
          action: () => run("format.paragraph"),
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "para.bullet",
          text: "Bullet list",
          accelerator: "CmdOrCtrl+Shift+8",
          action: () => run("format.bulletList"),
        },
        {
          kind: "item",
          id: "para.numbered",
          text: "Numbered list",
          accelerator: "CmdOrCtrl+Shift+7",
          action: () => run("format.numberedList"),
        },
        {
          kind: "item",
          id: "para.task",
          text: "Task list",
          accelerator: "CmdOrCtrl+Shift+Enter",
          action: () => run("format.taskList"),
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "para.blockquote",
          text: "Blockquote",
          accelerator: "CmdOrCtrl+Shift+.",
          action: () => run("format.blockquote"),
        },
        {
          kind: "item",
          id: "para.codeblock",
          text: "Code block",
          action: () => run("toggleFencedCodeBlock"),
        },
      ],
    });
    items.push({
      kind: "submenu",
      text: "Insert",
      items: [
        {
          kind: "item",
          id: "ins.link",
          text: "Link\u2026",
          accelerator: "CmdOrCtrl+K",
          action: () => run("format.link"),
        },
        { kind: "item", id: "ins.table", text: "Table", action: () => run("insertTable") },
        {
          kind: "item",
          id: "ins.hr",
          text: "Horizontal rule",
          action: () => run("insertHorizontalRule"),
        },
        { kind: "separator" },
        { kind: "item", id: "ins.date", text: "Current date", action: () => run("insertToday") },
        { kind: "item", id: "ins.time", text: "Current time", action: () => run("insertNow") },
      ],
    });
  }

  items.push({ kind: "separator" });
  items.push({ kind: "item", id: "select-all", text: "Select all", action: handlers.onSelectAll });

  if (hasLink && handlers.onOpenLink && handlers.onCopyLink) {
    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      id: "open-link",
      text: "Open link",
      action: handlers.onOpenLink,
    });
    items.push({
      kind: "item",
      id: "copy-link",
      text: "Copy link",
      action: handlers.onCopyLink,
    });
  }

  return items;
}

// -- Tab menu --

export type TabMenuActionId =
  | "close"
  | "close-others"
  | "close-all"
  | "reveal-in-sidebar"
  | "copy-path";

export interface TabMenuHandlers {
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onRevealInSidebar: () => void;
  onCopyPath: () => void;
}

export function buildTabMenuItemsSpec(
  handlers: TabMenuHandlers,
): Array<
  { kind: "item"; id: TabMenuActionId; text: string; action: () => void } | { kind: "separator" }
> {
  return [
    { kind: "item", id: "close", text: "Close", action: handlers.onClose },
    { kind: "item", id: "close-others", text: "Close others", action: handlers.onCloseOthers },
    { kind: "item", id: "close-all", text: "Close all", action: handlers.onCloseAll },
    { kind: "separator" },
    {
      kind: "item",
      id: "reveal-in-sidebar",
      text: "Reveal in sidebar",
      action: handlers.onRevealInSidebar,
    },
    { kind: "item", id: "copy-path", text: "Copy path", action: handlers.onCopyPath },
  ];
}

// -- Document title menu --

export type TitleMenuActionId = "rename" | "reveal" | "copy-path";

export interface TitleMenuHandlers {
  onRename: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
}

export function buildTitleMenuItemsSpec(
  handlers: TitleMenuHandlers,
  platform: Platform = detectPlatform(),
): Array<
  { kind: "item"; id: TitleMenuActionId; text: string; action: () => void } | { kind: "separator" }
> {
  return [
    { kind: "item", id: "rename", text: "Rename", action: handlers.onRename },
    {
      kind: "item",
      id: "reveal",
      text: revealLabelForPlatform(platform),
      action: handlers.onReveal,
    },
    { kind: "item", id: "copy-path", text: "Copy path", action: handlers.onCopyPath },
  ];
}

// -- Shared popup helper --

export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; action: () => void; accelerator?: string }
  | { kind: "separator" }
  | { kind: "submenu"; text: string; items: MenuItemSpec[] };

async function buildMenuItems(
  spec: MenuItemSpec[],
): Promise<Array<MenuItem | PredefinedMenuItem | Submenu>> {
  return Promise.all(
    spec.map(async (entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      if (entry.kind === "submenu") {
        const children = await buildMenuItems(entry.items);
        return Submenu.new({ text: entry.text, items: children });
      }
      return MenuItem.new({
        id: entry.id,
        text: entry.text,
        action: entry.action,
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      });
    }),
  );
}

export async function showNativeContextMenu(
  spec: MenuItemSpec[],
  at?: { x: number; y: number },
): Promise<void> {
  const items = await buildMenuItems(spec);
  const menu = await Menu.new({ items });
  if (at) {
    await menu.popup(new LogicalPosition(at.x, at.y));
  } else {
    await menu.popup();
  }
}
