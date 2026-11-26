import type { Settings } from './types';
export const defaultSettings: Settings = {
  theme: 'system',
  language: 'zh',
  fontSize: 16,
  lineHeight: 1.7,
  editor: { lineNumbers: true, wordWrap: true, tabSize: 2, autoPairs: true },
  preview: { math: true, mermaid: true, htmlPassthrough: false },
  files: { autoSave: 'onFocusChange', delayMs: 3000 },
  export: { pdfPageSize: 'A4', embedImages: true },
  customCss: '',
};
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
