export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_markdown: boolean;
  is_symlink: boolean;
  modified_at: number;
  title: string | null;
}

export interface FileContent {
  path: string;
  content: string;
  modified_at: number;
}

export interface WriteResult {
  path: string;
  modified_at: number;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  file_count: number;
}

export interface SearchResult {
  path: string;
  filename: string;
  relative_path: string;
  score: number;
  match_indices: number[];
}

export interface ContentSearchResult {
  path: string;
  line_number: number;
  line_content: string;
  match_ranges: [number, number][];
}

export interface IndexStats {
  file_count: number;
  duration_ms: number;
}
