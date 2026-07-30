/**
 * @module changelog-render
 *
 * Pure renderer that turns the project `CHANGELOG.md` markdown into the
 * HTML shown on the Changelog page. The changelog uses a small, fixed
 * grammar — `## <version> — <date>` release headings, an optional plain
 * tagline paragraph, `### <section>` category headings and `-` bullet
 * lists (nested by two-space indent) with `**bold**` and `` `code` ``
 * inline spans — so a dedicated renderer covers it without pulling in a
 * markdown library.
 */

import { escapeHtml } from './html-utils.js';

/**
 * Render one line's inline markdown (after HTML-escaping): `**bold**`
 * becomes `<strong>` and backtick spans become `<code>`.
 */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Render the changelog markdown as HTML, one string per release so the
 * page can show them incrementally (newest first, as in the file).
 *
 * Each `##` heading opens a release section; the first release gets a
 * "Latest" badge. Unrecognized plain-text lines render as paragraphs
 * (the tagline under each release heading).
 */
export function renderChangelogReleases(markdown: string): string[] {
  const releases: string[] = [];
  let out: string[] = [];
  let inRelease = false;
  // Bullet lists nest by indentation; `<li>` tags are closed lazily so a
  // deeper list can open inside the item that introduced it.
  let listDepth = 0;
  const liOpen: boolean[] = [];

  const closeLi = (depth: number): void => {
    if (liOpen[depth]) { out.push('</li>'); liOpen[depth] = false; }
  };
  const closeListsTo = (target: number): void => {
    while (listDepth > target) {
      closeLi(listDepth - 1);
      out.push('</ul>');
      listDepth--;
    }
  };
  const closeRelease = (): void => {
    closeListsTo(0);
    if (inRelease) { out.push('</section>'); inRelease = false; }
    if (out.length > 0) { releases.push(out.join('\n')); out = []; }
  };

  // Merge hard-wrapped bullets first: an indented non-bullet line continues
  // the previous bullet (older releases wrap long bullets), and merging
  // before rendering lets inline spans work across the wrap.
  const lines: string[] = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '' || line.startsWith('# ')) continue;
    const isBullet = /^\s*- /.test(line);
    if (!isBullet && /^\s/.test(line) && lines.length > 0 && /^\s*- /.test(lines[lines.length - 1])) {
      lines[lines.length - 1] += ` ${line.trim()}`;
      continue;
    }
    lines.push(line);
  }

  let firstRelease = true;
  for (const line of lines) {

    if (line.startsWith('## ')) {
      closeRelease();
      const heading = line.slice(3);
      // Release headings are "<version> — <date>"; keep unsplit headings whole.
      const parts = heading.split(' — ');
      const version = renderInline(parts[0]);
      const date = parts.length > 1 ? renderInline(parts.slice(1).join(' — ')) : '';
      const badge = firstRelease ? '<span class="changelog-badge">Latest</span>' : '';
      out.push('<section class="changelog-release">');
      out.push(`<header class="changelog-release-header"><h3 class="changelog-release-version">${version}</h3>${badge}${date ? `<span class="changelog-release-date">${date}</span>` : ''}</header>`);
      inRelease = true;
      firstRelease = false;
      continue;
    }

    if (line.startsWith('### ')) {
      closeListsTo(0);
      out.push(`<h4 class="changelog-section-title">${renderInline(line.slice(4))}</h4>`);
      continue;
    }

    const bullet = /^(\s*)- (.*)$/.exec(line);
    if (bullet) {
      const level = Math.floor(bullet[1].length / 2);
      closeListsTo(Math.min(listDepth, level + 1));
      while (listDepth < level + 1) {
        out.push('<ul class="changelog-list">');
        liOpen[listDepth] = false;
        listDepth++;
      }
      closeLi(listDepth - 1);
      out.push(`<li>${renderInline(bullet[2])}`);
      liOpen[listDepth - 1] = true;
      continue;
    }

    closeListsTo(0);
    out.push(`<p class="changelog-tagline">${renderInline(line)}</p>`);
  }
  closeRelease();
  return releases;
}

/** Render the changelog markdown as a single HTML string. */
export function renderChangelogHtml(markdown: string): string {
  return renderChangelogReleases(markdown).join('\n');
}
