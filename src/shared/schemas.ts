import { z } from 'zod';
export const encodingSchema = z.enum([
  'utf8',
  'utf8-bom',
  'gbk',
  'utf16le',
  'utf16be',
  'shift_jis',
]);
export const pathSchema = z
  .string()
  .min(1)
  .max(32768)
  .refine((p) => !p.includes('\0'));
export const textSchema = z.string().max(55 * 1024 * 1024);
export const metaSchema = z.object({
  path: pathSchema,
  mtimeMs: z.number().nonnegative(),
  size: z.number().nonnegative(),
  revision: z.string().max(100),
  encoding: encodingSchema,
  bom: z.boolean(),
  eol: z.enum(['lf', 'crlf']),
  hasTrailingNewline: z.boolean(),
  readonly: z.boolean(),
  large: z.boolean(),
});
export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark', 'sepia']),
  language: z.enum(['zh', 'en']),
  fontSize: z.number().int().min(12).max(28),
  lineHeight: z.number().min(1.2).max(2.4),
  editor: z.object({
    lineNumbers: z.boolean(),
    wordWrap: z.boolean(),
    tabSize: z.number().int().min(1).max(8),
    autoPairs: z.boolean(),
  }),
  preview: z.object({ math: z.boolean(), mermaid: z.boolean(), htmlPassthrough: z.boolean() }),
  files: z.object({
    autoSave: z.enum(['off', 'onFocusChange', 'afterDelay']),
    delayMs: z.number().min(1000).max(60000),
  }),
  export: z.object({ pdfPageSize: z.enum(['A4', 'Letter']), embedImages: z.boolean() }),
  customCss: z.string().max(100000),
});
export const snapshotTabSchema = z.object({
  id: z.string().max(100),
  path: pathSchema.nullable(),
  name: z.string().max(1000),
  text: textSchema.optional(),
  meta: metaSchema.nullable(),
  cursor: z.number().int().nonnegative(),
  scrollTop: z.number().nonnegative(),
  viewMode: z.enum(['source', 'split', 'preview', 'inline']),
});
export const sessionSchema = z.object({
  tabs: z.array(snapshotTabSchema).max(100),
  activeId: z.string().nullable(),
  root: pathSchema.nullable(),
  savedAt: z.number(),
});
