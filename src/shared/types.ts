export type Encoding = 'utf8' | 'utf8-bom' | 'gbk' | 'utf16le' | 'utf16be' | 'shift_jis';
export type ViewMode = 'source' | 'split' | 'preview' | 'inline';
export interface FileMeta {
  path: string;
  mtimeMs: number;
  size: number;
  revision: string;
  encoding: Encoding;
  bom: boolean;
  eol: 'lf' | 'crlf';
  hasTrailingNewline: boolean;
  readonly: boolean;
  large: boolean;
}
export interface FileDoc {
  meta: FileMeta;
  text: string;
  nextOffset?: number;
}
export interface TreeNode {
  name: string;
  path: string;
  directory: boolean;
}
export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark' | 'sepia';
  language: 'zh' | 'en';
  fontSize: number;
  lineHeight: number;
  editor: { lineNumbers: boolean; wordWrap: boolean; tabSize: number; autoPairs: boolean };
  preview: { math: boolean; mermaid: boolean; htmlPassthrough: boolean };
  files: { autoSave: 'off' | 'onFocusChange' | 'afterDelay'; delayMs: number };
  export: { pdfPageSize: 'A4' | 'Letter'; embedImages: boolean };
  customCss: string;
}
export interface SnapshotTab {
  id: string;
  path: string | null;
  name: string;
  text?: string;
  meta: FileMeta | null;
  cursor: number;
  scrollTop: number;
  viewMode: ViewMode;
}
export interface SessionSnapshot {
  tabs: SnapshotTab[];
  activeId: string | null;
  root: string | null;
  savedAt: number;
}
export interface Bootstrap {
  settings: Settings;
  recent: string[];
  session: SessionSnapshot | null;
  recovery: SnapshotTab[];
}
export type AppCommand =
  | 'new'
  | 'open'
  | 'folder'
  | 'save'
  | 'saveAs'
  | 'closeTab'
  | 'find'
  | 'replace'
  | 'view'
  | 'outline'
  | 'focus'
  | 'settings'
  | 'exportHtml'
  | 'exportPdf';
export type Result<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  readyForFiles(): Promise<void>;
  openDialog(): Promise<FileDoc[]>;
  open(path: string, encoding?: Encoding): Promise<FileDoc>;
  inspect(path: string, encoding: Encoding): Promise<FileMeta>;
  openDropped(file: File): Promise<FileDoc>;
  readPage(
    path: string,
    offset: number,
    encoding: Encoding,
  ): Promise<{ text: string; nextOffset?: number }>;
  save(text: string, meta: FileMeta): Promise<FileMeta>;
  saveAs(text: string, name: string, source?: FileMeta): Promise<FileMeta | null>;
  closeFile(path: string): Promise<void>;
  pickWorkspace(): Promise<string | null>;
  list(path: string): Promise<TreeNode[]>;
  search(
    query: string,
    caseSensitive: boolean,
  ): Promise<{ matches: SearchMatch[]; truncated: boolean; engine: string }>;
  cancelSearch(): Promise<void>;
  rename(path: string, name: string): Promise<FileDoc | null>;
  trash(path: string): Promise<boolean>;
  reveal(path: string): Promise<void>;
  writeImage(path: string, bytes: Uint8Array): Promise<string>;
  exportDocument(html: string, name: string, format: 'html' | 'pdf'): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  setSettings(settings: Settings): Promise<Settings>;
  saveSession(session: SessionSnapshot): Promise<void>;
  clearRecovery(): Promise<void>;
  confirmClose(name: string): Promise<'save' | 'discard' | 'cancel'>;
  finishClose(): Promise<void>;
  checkUpdates(): Promise<string>;
  onCommand(callback: (command: AppCommand) => void): () => void;
  onOpen(callback: (doc: FileDoc) => void): () => void;
  onFileChanged(callback: (path: string) => void): () => void;
  onCloseRequested(callback: () => void): () => void;
}
