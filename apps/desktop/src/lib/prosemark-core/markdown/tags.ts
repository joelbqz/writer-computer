import { Tag } from "@lezer/highlight";

export const markdownTags = {
  headerMark: Tag.define(),
  fencedCode: Tag.define(),
  linkURL: Tag.define(),
  escapeMark: Tag.define(),
  emoji: Tag.define(),
  emojiMark: Tag.define(),
  listMark: Tag.define(),
  dash: Tag.define(),
};
