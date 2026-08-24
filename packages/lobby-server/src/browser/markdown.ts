/**
 * @module markdown
 *
 * Minimal Markdown-to-HTML renderer for displaying mail message bodies.
 * Supports headings, bold, italic, inline code, code blocks, images,
 * links, unordered/ordered lists, tables, and paragraphs. Output is sanitized to
 * prevent XSS — no raw HTML passes through.
 */

import { escapeHtml } from './html-utils.js';

/** Render inline markdown (bold, italic, code, links) within a line. */
function renderInline(text: string): string {
  let result = escapeHtml(text);
  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Images ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-image">');
  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Auto-link bare URLs. The `[^"=]` guard keeps href/src attribute values
  // from being wrapped, but a URL inside an anchor's *display text* — the
  // common `[https://foo](https://foo)` mail pattern — is preceded by `>`
  // and would get a second <a> nested inside the first (invalid HTML the
  // browser splits into broken sibling anchors). Guarding on `>` instead
  // would stop URLs inside <strong>/<em>/<code> from auto-linking, so the
  // finished anchors are masked out for this pass and restored after.
  const anchors: string[] = [];
  result = result.replace(/<a [^>]*>.*?<\/a>/g, (anchor) => {
    anchors.push(anchor);
    return `\u0000${anchors.length - 1}\u0000`;
  });
  result = result.replace(/(^|[^"=])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  // eslint-disable-next-line no-control-regex -- the NUL sentinel cannot occur in escaped text
  result = result.replace(/\u0000(\d+)\u0000/g, (placeholder, index) => anchors[Number(index)] ?? placeholder);
  return result;
}

/** Render a markdown string to sanitized HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      html.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      html.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        html.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      html.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      html.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        html.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      html.push('</ol>');
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        // Skip separator rows (e.g. |---|---|)
        if (cells.every(c => /^[-: ]+$/.test(c))) {
          i++;
          continue;
        }
        rows.push(cells);
        i++;
      }
      if (rows.length > 0) {
        const headerCells = rows[0].map(c => `<th>${renderInline(c)}</th>`).join('');
        const bodyRows = rows.slice(1).map(row =>
          `<tr>${row.map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`
        ).join('\n');
        html.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>\n${bodyRows}\n</tbody></table>`);
      }
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }

  return html.join('\n');
}
