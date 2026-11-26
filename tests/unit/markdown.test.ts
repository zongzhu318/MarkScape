// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, assetUrl, sanitize } from '../../src/renderer/src/markdown/render';
import { defaultSettings } from '../../src/shared/defaults';
const render = (text: string, html = false) =>
  renderMarkdown(text, '/workspace/docs/notes.md', {
    ...defaultSettings.preview,
    htmlPassthrough: html,
  });
describe('Markdown semantics and source mapping', () => {
  it('supports GFM, task source lines, repeated heading ids, and cross-block footnotes/references', () => {
    const output = render(
      '# 标题\n\n# 标题\n\n- [ ] Task\n\n| A | B |\n| - | - |\n| a | b |\n\n~~done~~ [reference][id] and footnote[^n]\n\n[id]: https://example.com\n\n[^n]: A footnote',
    );
    expect(output.headings.map((item) => item.id)).toEqual(['标题', '标题-1']);
    expect(output.html).toContain('<table');
    expect(output.html).toContain('<s>done</s>');
    expect(output.html).toContain('data-task-line="5"');
    expect(output.html).toContain('href="https://example.com"');
    expect(output.html).toContain('A footnote');
  });
  it('preserves original line numbers after front matter', () => {
    const output = render('---\ntitle: Example\n---\n\n# Heading');
    expect(output.frontmatter).toEqual({ title: 'Example' });
    expect(output.headings[0].line).toBe(5);
  });
  it('renders math and defers diagrams/code with escaped content', () => {
    const output = render(
      '$x^2$\n\n$$\n\\frac{1}{2}\n$$\n\n```mermaid\ngraph LR\nA-->B\n```\n\n```html\n<script>alert(1)</script>\n```',
    );
    expect(output.html).toContain('katex');
    expect(output.html).toContain('data-diagram');
    expect(output.html).toContain('&lt;script&gt;');
  });
  it('maps relative local assets without exposing file URLs', () => {
    expect(assetUrl('images/a b.png', '/work/doc.md')).toBe(
      'mdasset://local/%2Fwork%2Fimages%2Fa%20b.png',
    );
    expect(assetUrl('file:///etc/passwd', '/work/doc.md')).toBe('');
    expect(assetUrl('https://example.com/tracker.png', '/work/doc.md')).toBe('');
  });
});
describe('untrusted Markdown', () => {
  it.each([
    '<script>window.hacked=true</script>',
    '<img src=x onerror="alert(1)">',
    '<iframe src="file:///etc/passwd"></iframe>',
    '<a href="javascript:alert(1)">bad</a>',
    '<svg><a href="javascript:alert(1)">bad</a></svg>',
    '<form action="https://example.com"><input formaction="https://example.com"></form>',
    '<img srcset="https://evil.com/track 1x" src="file:///etc/passwd">',
    '<object data="file:///etc/passwd"></object>',
    '<svg><foreignObject><iframe src="https://evil.com"></iframe></foreignObject></svg>',
  ])('sanitizes %s', (input) => {
    const output = render(input, true).html;
    expect(output).not.toMatch(
      /<script|<iframe|<object|<form\b|onerror=|javascript:|srcset=|file:\/\//i,
    );
  });
  it('blocks styles and forms even in generated SVG', () => {
    expect(
      sanitize('<style>body{display:none}</style><svg onload="alert(1)"><path d="M0 0"/></svg>'),
    ).not.toMatch(/<style|onload/);
  });
});
