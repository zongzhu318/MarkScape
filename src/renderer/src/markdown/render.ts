import MarkdownIt from 'markdown-it';
import type { PluginSimple, PluginWithOptions } from 'markdown-it';
import Token from 'markdown-it/lib/token.mjs';
import footnote from 'markdown-it-footnote';
import attrs from 'markdown-it-attrs';
import tasks from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { parseDocument } from 'yaml';
import type { Settings } from '../../../shared/types';

export interface Heading {
  id: string;
  text: string;
  level: number;
  line: number;
}
export interface RenderResult {
  html: string;
  headings: Heading[];
  frontmatter: Record<string, unknown> | null;
}
export function assetUrl(source: string, documentPath: string | null): string {
  if (/^(data:image\/(png|jpeg|gif|webp);base64,)/i.test(source)) return source;
  if (!documentPath || /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return '';
  const normalized = documentPath.replace(/\\/g, '/');
  const directory = normalized.slice(0, normalized.lastIndexOf('/'));
  const segments = `${directory}/${decodeURIComponent(source)}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '..') resolved.pop();
    else if (segment !== '.') resolved.push(segment);
  }
  return `mdasset://local/${encodeURIComponent(resolved.join('/'))}`;
}
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: [
      'data-line-start',
      'data-task-line',
      'data-language',
      'data-code',
      'data-diagram',
      'data-math',
      'target',
    ],
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'style',
      'link',
      'meta',
      'foreignObject',
    ],
    FORBID_ATTR: ['srcset', 'formaction'],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|mdasset):|data:image\/(?:png|jpeg|gif|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.: -]|$))/i,
  });
}
function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    let end = state.pos + 1;
    while ((end = state.src.indexOf('$', end)) !== -1 && state.src[end - 1] === '\\') end++;
    if (end === -1 || end === state.pos + 1 || state.src.slice(state.pos, end).includes('\n'))
      return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!first.startsWith('$$')) return false;
    if (silent) return true;
    let line = start;
    let content = first.slice(2);
    if (content.endsWith('$$')) content = content.slice(0, -2);
    else {
      let closed = false;
      for (line = start + 1; line < end; line++) {
        const value = state.src.slice(state.bMarks[line], state.eMarks[line]);
        if (value.trimEnd().endsWith('$$')) {
          content += `\n${value.trimEnd().slice(0, -2)}`;
          closed = true;
          break;
        }
        content += `\n${value}`;
      }
      if (!closed) return false;
    }
    const token = state.push('math_block', 'div', 0);
    token.content = content.trim();
    token.map = [start, line + 1];
    token.block = true;
    state.line = line + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, index) =>
    katex.renderToString(tokens[index].content, {
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  md.renderer.rules.math_block = (tokens, index) =>
    `<div class="math-block" data-line-start="${tokens[index].map![0] + 1}">${katex.renderToString(tokens[index].content, { displayMode: true, throwOnError: false, trust: false, strict: 'ignore' })}</div>`;
}
export function renderMarkdown(
  text: string,
  documentPath: string | null,
  settings: Settings['preview'],
): RenderResult {
  let frontmatter: Record<string, unknown> | null = null;
  const front = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (front) {
    try {
      const document = parseDocument(front[1]);
      if (!document.errors.length) {
        const data: unknown = document.toJS({ maxAliasCount: 50 });
        if (data && typeof data === 'object' && !Array.isArray(data))
          frontmatter = data as Record<string, unknown>;
      }
    } catch {
      /* show malformed front matter as Markdown */
    }
    if (frontmatter)
      text = '\n'.repeat(front[0].split('\n').length - 1) + text.slice(front[0].length);
  }
  // The plugin declarations use markdown-it's CJS type entry; bridge to the equivalent ESM types.
  const md = new MarkdownIt({ html: settings.htmlPassthrough, linkify: true, typographer: false })
    .use(footnote as unknown as PluginSimple)
    .use(attrs as unknown as PluginWithOptions<{ allowedAttributes: string[] }>, {
      allowedAttributes: ['id', 'class'],
    })
    .use(tasks, { enabled: true });
  if (settings.math) md.use(mathPlugin);
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0];
    const line = (token.map?.[0] ?? 0) + 1;
    if (language === 'mermaid' && settings.mermaid)
      return `<div class="mermaid-block" data-diagram="${md.utils.escapeHtml(encodeURIComponent(token.content))}" data-line-start="${line}"><pre>${md.utils.escapeHtml(token.content)}</pre></div>`;
    return `<pre data-language="${md.utils.escapeHtml(language)}" data-line-start="${line}"><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
  };
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = token.attrGet('src') ?? '';
    try {
      token.attrSet('src', assetUrl(source, documentPath));
    } catch {
      token.attrSet('src', '');
    }
    if (!token.content)
      token.children = [
        Object.assign(new Token('text', '', 0), { content: source.split('/').pop() ?? 'image' }),
      ];
    token.attrSet('loading', 'lazy');
    return image(tokens, index, options, env, self);
  };
  const env = {};
  const tokens = md.parse(text, env);
  const headings: Heading[] = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.map && token.nesting !== -1 && token.type !== 'inline')
      token.attrSet('data-line-start', String(token.map[0] + 1));
    if (token.type === 'heading_open') {
      const title =
        tokens[i + 1].children
          ?.filter((child) => ['text', 'code_inline'].includes(child.type))
          .map((child) => child.content)
          .join('') ?? tokens[i + 1].content;
      const slug =
        title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/\s+/g, '-') || 'heading';
      const count = counts.get(slug) ?? 0;
      counts.set(slug, count + 1);
      const id = token.attrGet('id') ?? `${slug}${count ? `-${count}` : ''}`;
      token.attrSet('id', id);
      headings.push({
        id,
        text: title,
        level: Number(token.tag.slice(1)),
        line: (token.map?.[0] ?? 0) + 1,
      });
    }
    if (token.type === 'inline' && token.map)
      for (const child of token.children ?? []) {
        if (child.type === 'html_inline' && child.content.includes('task-list-item-checkbox'))
          child.content = child.content.replace(
            '<input ',
            `<input data-task-line="${token.map[0] + 1}" `,
          );
      }
  }
  return { html: sanitize(md.renderer.render(tokens, md.options, env)), headings, frontmatter };
}
