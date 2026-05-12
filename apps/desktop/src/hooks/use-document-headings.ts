import { useMemo } from "react";
import { useFileContent } from "@/hooks/use-tabs";

export interface DocumentHeading {
  level: number;
  text: string;
  line: number;
  pos: number;
  slug: string;
}

export interface DocumentHeadingsOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 3;

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function parseDocumentHeadings(content: string, maxDepth: number): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  let inFence = false;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let pos = 0;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/^\s+/, "");
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceLen = marker.length;
      } else if (ch === fenceChar && marker.length >= fenceLen) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
    } else if (!inFence) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) {
        const level = match[1].length;
        if (level <= maxDepth) {
          const text = match[2].trim();
          if (text) {
            headings.push({ level, text, line: i, pos, slug: slugify(text) });
          }
        }
      }
    }
    pos += line.length + 1;
  }
  return headings;
}

export function useDocumentHeadings(
  filePath: string | null,
  options: DocumentHeadingsOptions = {},
): DocumentHeading[] {
  const content = useFileContent(filePath);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  return useMemo(() => parseDocumentHeadings(content, maxDepth), [content, maxDepth]);
}
