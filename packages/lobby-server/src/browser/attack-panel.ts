/**
 * @module attack-panel
 *
 * The combat arena's "Attack" info panel: a box that stays up for the whole
 * attack and lists the attack's starting statistics, every change cards made
 * to it (from `combat.attackLog` — e.g. "Bob played Dark Quarrels: strikes
 * 2 → 1 (halved)") and the current totals. Lets both players follow chain-less
 * modifications (halve strikes, modify-attack, cancel-by-tap …) that would
 * otherwise only flash by in the message log.
 *
 * The line text comes from the pure `attack-panel-lines` module so it can be
 * unit-tested; {@link renderAttackPanel} only builds the DOM.
 */

import type { CardDefinition, CombatState, PlayerId, PlayerView } from '@meccg/shared';
import { textToHtml, tagCardImages } from './render-text-format.js';
import { attackPanelLines } from './attack-panel-lines.js';

/** Render the attack panel element for the combat arena. */
export function renderAttackPanel(
  combat: CombatState,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const nameOf = (id: PlayerId): string | undefined =>
    id === view.self.id ? view.self.name : id === view.opponent.id ? view.opponent.name : undefined;
  const { entries, totals } = attackPanelLines(combat, cardPool, nameOf);

  const panel = document.createElement('div');
  panel.className = 'attack-log-panel';
  const title = document.createElement('div');
  title.className = 'attack-log-title';
  title.textContent = 'Attack';
  panel.appendChild(title);
  for (const text of entries) {
    const row = document.createElement('div');
    row.className = text.startsWith('Attack:') ? 'attack-log-row attack-log-row--base' : 'attack-log-row';
    row.innerHTML = textToHtml(text);
    panel.appendChild(row);
  }
  const now = document.createElement('div');
  now.className = 'attack-log-totals';
  now.textContent = `Now: ${totals}`;
  panel.appendChild(now);
  tagCardImages(panel, cardPool);
  return panel;
}
