import { describe, it, expect } from 'vitest';
import { renderChangelogHtml, renderChangelogReleases } from './changelog-render.js';

/**
 * Tests for the changelog markdown renderer used by the Changelog page.
 * The input grammar is the one CHANGELOG.md actually uses: a `#` title,
 * `## <version> — <date>` release headings, a plain tagline line,
 * `### <section>` headings and `-` bullets with `**bold**` / `` `code` ``
 * inline spans.
 */
describe('renderChangelogHtml', () => {
  const SAMPLE = [
    '# Changelog',
    '',
    '## 0.68.0 — 2026-07-30',
    '',
    'More Features',
    '',
    '### Game Engine',
    '',
    '- **Implemented Reforging (tw-314)** play-time conditions',
    '- Fixed Flatter a Foe leaving the chain stuck in `resolving`',
    '',
    '## 0.67.0 — 2026-07-30',
    '',
    'Various Improvements',
    '',
    '### Lobby & Web Client',
    '',
    '- The game server exits once no human player is connected',
  ].join('\n');

  it('renders one section per release with version and date split out', () => {
    const html = renderChangelogHtml(SAMPLE);
    expect(html.match(/<section class="changelog-release">/g)).toHaveLength(2);
    expect(html).toContain('<h3 class="changelog-release-version">0.68.0</h3>');
    expect(html).toContain('<span class="changelog-release-date">2026-07-30</span>');
    expect(html).toContain('<h3 class="changelog-release-version">0.67.0</h3>');
  });

  it('returns one self-contained chunk per release for pagination', () => {
    const releases = renderChangelogReleases(SAMPLE);
    expect(releases).toHaveLength(2);
    expect(releases[0]).toContain('0.68.0');
    expect(releases[0]).not.toContain('0.67.0');
    expect(releases[1]).toContain('0.67.0');
    for (const chunk of releases) {
      expect(chunk.startsWith('<section class="changelog-release">')).toBe(true);
      expect(chunk.endsWith('</section>')).toBe(true);
    }
  });

  it('marks only the first release as Latest', () => {
    const html = renderChangelogHtml(SAMPLE);
    expect(html.match(/changelog-badge/g)).toHaveLength(1);
    expect(html.indexOf('changelog-badge')).toBeLessThan(html.indexOf('0.67.0'));
  });

  it('skips the top-level title and renders taglines as paragraphs', () => {
    const html = renderChangelogHtml(SAMPLE);
    expect(html).not.toContain('Changelog</');
    expect(html).toContain('<p class="changelog-tagline">More Features</p>');
    expect(html).toContain('<p class="changelog-tagline">Various Improvements</p>');
  });

  it('renders section headings and bullet lists with inline formatting', () => {
    const flat = renderChangelogHtml(SAMPLE).replace(/\n/g, '');
    expect(flat).toContain('<h4 class="changelog-section-title">Game Engine</h4>');
    expect(flat).toContain('<h4 class="changelog-section-title">Lobby &amp; Web Client</h4>');
    expect(flat).toContain('<li><strong>Implemented Reforging (tw-314)</strong> play-time conditions</li>');
    expect(flat).toContain('<li>Fixed Flatter a Foe leaving the chain stuck in <code>resolving</code></li>');
  });

  it('closes a bullet list before the next release section starts', () => {
    const html = renderChangelogHtml(SAMPLE);
    const secondRelease = html.indexOf('0.67.0');
    const firstClose = html.indexOf('</ul>');
    expect(firstClose).toBeGreaterThan(-1);
    expect(firstClose).toBeLessThan(secondRelease);
  });

  it('nests two-space-indented bullets inside the parent item', () => {
    const html = renderChangelogHtml([
      '## 1.0.0 — 2026-01-01',
      '',
      '- Certified cards:',
      '  - Hero characters — Gildor Inglorion (tw-158)',
      '  - Hero items — Orcrist (tw-295)',
      '- Another top-level entry',
    ].join('\n'));
    const flat = html.replace(/\n/g, '');
    expect(flat).toContain('<li>Certified cards:<ul class="changelog-list"><li>Hero characters — Gildor Inglorion (tw-158)</li><li>Hero items — Orcrist (tw-295)</li></ul></li>');
    expect(flat).toContain('<li>Another top-level entry</li>');
    expect(html).not.toContain('changelog-tagline');
    expect(html.match(/<li>/g)).toHaveLength(html.match(/<\/li>/g)!.length);
    expect(html.match(/<ul/g)).toHaveLength(html.match(/<\/ul>/g)!.length);
  });

  it('joins wrapped continuation lines onto the open bullet', () => {
    const flat = renderChangelogHtml([
      '## 1.0.0 — 2026-01-01',
      '',
      '- **Faction influence attempts:** Play factions at their designated sites during',
      '  the site phase, with a two-step UI',
      '- Next entry',
    ].join('\n')).replace(/\n/g, '');
    expect(flat).toContain('<li><strong>Faction influence attempts:</strong> Play factions at their designated sites during the site phase, with a two-step UI</li>');
    expect(flat).not.toContain('changelog-tagline');
  });

  it('escapes HTML in changelog text', () => {
    const html = renderChangelogHtml('## 1.0.0 — 2026-01-01\n\n- Fixed <script> handling & "quotes"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; &quot;quotes&quot;');
    expect(html).not.toContain('<script>');
  });

  it('keeps a heading without a date whole', () => {
    const html = renderChangelogHtml('## Unreleased\n\n- Something');
    expect(html).toContain('<h3 class="changelog-release-version">Unreleased</h3>');
    expect(html).not.toContain('changelog-release-date');
  });
});
