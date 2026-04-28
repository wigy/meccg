/**
 * @module deck-view
 *
 * Right pane of the deck editor: grouped card list, progress bars, live
 * validation feedback, and deck-management footer buttons.
 */

import type { CardDefinition } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';
import type { FullDeck } from './app-state.js';
import { computeStats, validateDeck } from './deck-validation.js';
import { showCardTooltip, hideCardTooltip } from './card-detail.js';

/** Render the deck view into `container`. Call again after any deck change. */
export function renderDeckView(
  container: HTMLElement,
  deck: FullDeck,
  pool: Readonly<Record<string, CardDefinition>>,
  onRemove: (cardId: string, section: 'pool' | 'characters' | 'resources' | 'hazards' | 'sites' | 'sideboard') => void,
  onClear: () => void,
  onExport: () => void,
): void {
  container.innerHTML = '';

  const stats = computeStats(deck);
  const issues = validateDeck(deck, pool);

  // ----- Progress bars -----
  const bars = document.createElement('div');
  bars.className = 'de-progress-bars';

  function bar(label: string, value: number, max: number, cls: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'de-progress-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'de-progress-label';
    labelEl.textContent = `${label} ${value}/${max}`;
    const track = document.createElement('div');
    track.className = 'de-progress-track';
    const fill = document.createElement('div');
    fill.className = `de-progress-fill ${cls}`;
    fill.style.width = `${Math.min((value / max) * 100, 100)}%`;
    track.appendChild(fill);
    wrap.appendChild(labelEl);
    wrap.appendChild(track);
    return wrap;
  }

  bars.appendChild(bar('Characters', stats.characters, 10, 'de-progress--char'));
  bars.appendChild(bar('Resources', stats.resources, 25, 'de-progress--res'));
  bars.appendChild(bar('Hazards', stats.hazards, 25, 'de-progress--haz'));
  container.appendChild(bars);

  // ----- Validation pills -----
  if (issues.length > 0) {
    const pills = document.createElement('div');
    pills.className = 'de-validation-pills';
    for (const issue of issues) {
      const pill = document.createElement('span');
      pill.className = `de-pill de-pill--${issue.severity}`;
      pill.textContent = issue.message;
      pills.appendChild(pill);
    }
    container.appendChild(pills);
  } else if (stats.playDeck >= 25) {
    const pill = document.createElement('div');
    pill.className = 'de-validation-pills';
    const ok = document.createElement('span');
    ok.className = 'de-pill de-pill--ok';
    ok.textContent = 'Valid';
    pill.appendChild(ok);
    container.appendChild(pill);
  }

  // ----- Deck sections -----
  const sections: {
    key: 'pool' | 'characters' | 'resources' | 'hazards' | 'sites' | 'sideboard';
    label: string;
    entries: FullDeck['pool'];
  }[] = [
    { key: 'characters', label: 'Characters', entries: deck.deck.characters },
    { key: 'pool', label: 'Pool', entries: deck.pool },
    { key: 'resources', label: 'Resources', entries: deck.deck.resources },
    { key: 'hazards', label: 'Hazards', entries: deck.deck.hazards },
    { key: 'sites', label: 'Sites', entries: deck.sites },
    { key: 'sideboard', label: 'Sideboard', entries: deck.sideboard ?? [] },
  ];

  const deckList = document.createElement('div');
  deckList.className = 'de-deck-list';

  for (const sec of sections) {
    if (sec.entries.length === 0) continue;
    const total = sec.entries.reduce((s, e) => s + e.qty, 0);

    const group = document.createElement('div');
    group.className = 'de-deck-group';

    const heading = document.createElement('div');
    heading.className = 'de-deck-heading';
    heading.textContent = `${sec.label} (${total})`;
    group.appendChild(heading);

    // Sort alphabetically
    const sorted = [...sec.entries].sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      const row = document.createElement('div');
      row.className = 'de-deck-row';
      if (entry.card) row.dataset.cardId = entry.card;

      const count = document.createElement('span');
      count.className = 'de-deck-count';
      count.textContent = `×${entry.qty}`;
      row.appendChild(count);

      const name = document.createElement('span');
      name.className = 'de-deck-name';
      name.textContent = entry.name;
      row.appendChild(name);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'de-deck-remove';
      removeBtn.title = 'Remove one copy';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entry.card) onRemove(entry.card, sec.key);
      });
      row.appendChild(removeBtn);

      // Hover: show card tooltip
      row.addEventListener('mouseenter', () => {
        if (!entry.card) return;
        const def = pool[entry.card];
        if (def) showCardTooltip(def, row);
      });
      row.addEventListener('mouseleave', () => hideCardTooltip());

      // Right-click to remove as well
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (entry.card) onRemove(entry.card, sec.key);
      });

      group.appendChild(row);
    }

    deckList.appendChild(group);
  }

  if (sections.every((s) => s.entries.length === 0)) {
    const empty = document.createElement('div');
    empty.className = 'de-deck-empty';
    empty.textContent = 'Add cards from the browser to build your deck.';
    deckList.appendChild(empty);
  }

  container.appendChild(deckList);

  // ----- Footer buttons -----
  const footer = document.createElement('div');
  footer.className = 'de-deck-footer';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'de-footer-btn';
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', onClear);
  footer.appendChild(clearBtn);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'de-footer-btn';
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', onExport);
  footer.appendChild(exportBtn);

  container.appendChild(footer);
}

/** Build a plain-text export of the deck. */
export function exportDeckText(deck: FullDeck): string {
  const lines: string[] = [`${deck.name} (${deck.alignment})\n`];

  function renderSection(label: string, entries: FullDeck['pool']): void {
    if (entries.length === 0) return;
    lines.push(`[${label}]`);
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(e.qty > 1 ? `${e.qty}x ${e.name}` : e.name);
    }
    lines.push('');
  }

  renderSection('Characters', deck.deck.characters);
  renderSection('Pool', deck.pool);
  renderSection('Resources', deck.deck.resources);
  renderSection('Hazards', deck.deck.hazards);
  renderSection('Sites', deck.sites);
  renderSection('Sideboard', deck.sideboard ?? []);

  return lines.join('\n');
}

/** Build a card image gallery string (card image paths joined by newlines). */
export function getDeckImagePaths(deck: FullDeck, pool: Readonly<Record<string, CardDefinition>>): string[] {
  const paths: string[] = [];
  const all = [
    ...deck.pool, ...deck.deck.characters, ...deck.deck.resources,
    ...deck.deck.hazards, ...deck.sites,
  ];
  for (const entry of all) {
    if (!entry.card) continue;
    const def = pool[entry.card];
    if (!def) continue;
    const p = cardImageProxyPath(def);
    if (p) paths.push(p);
  }
  return paths;
}
