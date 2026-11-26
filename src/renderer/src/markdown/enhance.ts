import { sanitize } from './render';

const diagrams = new Map<string, string>();
const highlighted = new Map<string, string>();
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
let shikiPromise: Promise<typeof import('shiki')> | null = null;
let highlighter: Awaited<ReturnType<(typeof import('shiki'))['createHighlighter']>> | null = null;
let highlightQueue = Promise.resolve();
async function highlightCode(code: string, language: string): Promise<string> {
  let html = '';
  const job = highlightQueue
    .catch(() => undefined)
    .then(async () => {
      const shiki = await (shikiPromise ??= import('shiki'));
      const lang =
        language in shiki.bundledLanguages
          ? (language as keyof typeof shiki.bundledLanguages)
          : 'text';
      if (
        highlighter &&
        !highlighter.getLoadedLanguages().includes(lang) &&
        highlighter.getLoadedLanguages().length >= 8
      ) {
        highlighter.dispose();
        highlighter = null;
      }
      if (!highlighter) {
        // JavaScript regexp engine avoids enabling unsafe-eval/WASM in the renderer CSP.
        const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
        highlighter = await shiki.createHighlighter({
          themes: ['github-light', 'github-dark'],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        });
      }
      if (lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang))
        await highlighter.loadLanguage(lang);
      html = highlighter.codeToHtml(code, {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
      });
    });
  highlightQueue = job;
  await job;
  return html;
}
function cache(cache: Map<string, string>, key: string, value: string): void {
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}
export async function enhanceElement(element: HTMLElement): Promise<void> {
  if (element.dataset.enhanced === 'true') return;
  const source =
    element.dataset.diagram === undefined ? undefined : decodeURIComponent(element.dataset.diagram);
  if (source !== undefined) {
    if (source.length > 30000 || source.split('\n').length > 200) {
      element.textContent = '图表过大，显示源码 / Diagram too large\n' + source;
      return;
    }
    try {
      let html = diagrams.get(source);
      if (!html) {
        const { default: mermaid } = await (mermaidPromise ??= import('mermaid'));
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'sans-serif',
          flowchart: { htmlLabels: false },
          suppressErrorRendering: true,
        });
        const result = await mermaid.render(`diagram-${crypto.randomUUID()}`, source);
        html = sanitize(result.svg);
        cache(diagrams, source, html);
      }
      element.innerHTML = html;
      element.dataset.enhanced = 'true';
    } catch {
      element.dataset.enhanced = 'true';
      element.classList.add('diagram-error');
    }
    return;
  }
  if (element.matches('pre[data-language]')) {
    const code = element.textContent ?? '';
    const language = element.dataset.language || 'text';
    const key = `${language}:${code}`;
    try {
      let html = highlighted.get(key);
      if (!html) {
        if (code.length > 30000) {
          const { default: hljs } = await import('highlight.js/lib/common');
          html = hljs.getLanguage(language)
            ? `<pre><code>${hljs.highlight(code, { language }).value}</code></pre>`
            : '';
        } else {
          html = await highlightCode(code, language);
        }
        if (html) cache(highlighted, key, html);
      }
      if (html) {
        const parsed = document.createElement('div');
        parsed.innerHTML = sanitize(html);
        const codeElement = parsed.querySelector('code');
        if (codeElement) element.replaceChildren(codeElement);
      }
      element.dataset.enhanced = 'true';
    } catch {
      /* preserve escaped plaintext when a grammar fails */
    }
  }
}
export async function enhanceAll(root: HTMLElement): Promise<void> {
  for (const element of root.querySelectorAll<HTMLElement>('[data-diagram], pre[data-language]'))
    await enhanceElement(element);
}
