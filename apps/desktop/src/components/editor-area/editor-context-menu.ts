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
import {
  chordToAccelerator,
  editorCommands,
  type EditorCommand,
  type EditorCommandId,
} from "./markdown-formatting";

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
  onRunCommand?: (id: EditorCommandId) => void;
}

// Menu ids stay stable for tests and telemetry; text and accelerator come from
// the command registry. `"---"` is a separator; the optional third element
// overrides the registry label where the submenu context wants different
// wording ("Insert link…" under Format, "Link…" under Insert).
type CommandMenuLayout = ReadonlyArray<"---" | readonly [string, EditorCommandId, string?]>;

const FORMAT_SUBMENU: CommandMenuLayout = [
  ["fmt.bold", "format.bold"],
  ["fmt.italic", "format.italic"],
  ["fmt.strikethrough", "format.strikethrough"],
  ["fmt.code", "format.code"],
  "---",
  ["fmt.link", "format.link", "Insert link\u2026"],
  "---",
  ["fmt.clear", "format.clearFormatting"],
];

const PARAGRAPH_SUBMENU: CommandMenuLayout = [
  ["para.h1", "format.heading1"],
  ["para.h2", "format.heading2"],
  ["para.h3", "format.heading3"],
  ["para.h4", "format.heading4"],
  ["para.h5", "format.heading5"],
  ["para.h6", "format.heading6"],
  ["para.paragraph", "format.paragraph"],
  "---",
  ["para.bullet", "format.bulletList"],
  ["para.numbered", "format.numberedList"],
  ["para.task", "format.taskList"],
  "---",
  ["para.blockquote", "format.blockquote"],
  ["para.codeblock", "format.codeBlock"],
];

const INSERT_SUBMENU: CommandMenuLayout = [
  ["ins.link", "format.link"],
  ["ins.table", "insert.table"],
  ["ins.hr", "insert.horizontalRule"],
  "---",
  ["ins.date", "insert.today"],
  ["ins.time", "insert.now"],
];

const EDITOR_COMMAND_SUBMENUS: ReadonlyArray<readonly [string, CommandMenuLayout]> = [
  ["Format", FORMAT_SUBMENU],
  ["Paragraph", PARAGRAPH_SUBMENU],
  ["Insert", INSERT_SUBMENU],
];

function buildCommandItems(
  layout: CommandMenuLayout,
  run: (id: EditorCommandId) => void,
): MenuItemSpec[] {
  return layout.map((entry) => {
    if (entry === "---") return { kind: "separator" };
    const [id, commandId, label] = entry;
    const command: EditorCommand = editorCommands[commandId];
    return {
      kind: "item",
      id,
      text: label ?? command.label,
      action: () => run(commandId),
      ...(command.chord ? { accelerator: chordToAccelerator(command.chord) } : {}),
    };
  });
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
    for (const [text, layout] of EDITOR_COMMAND_SUBMENUS) {
      items.push({ kind: "submenu", text, items: buildCommandItems(layout, run) });
    }
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
