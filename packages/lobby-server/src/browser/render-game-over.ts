/**
 * @module render-game-over
 *
 * Renders the Game Over scoring table on the visual board.
 * Shows marshalling point categories as rows with both players' scores
 * and the contributing cards displayed as mini card images.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CharacterInPlay } from '@meccg/shared';
import type { MarshallingPointTotals } from '@meccg/shared';
import { cardImageProxyPath, computeTournamentScore, computeTournamentBreakdown, Phase } from '@meccg/shared';
import { $ } from './render-utils.js';

/** MP category labels in display order. */
const MP_CATEGORIES: { key: keyof MarshallingPointTotals; label: string }[] = [
  { key: 'character', label: 'Characters' },
  { key: 'item', label: 'Items' },
  { key: 'faction', label: 'Factions' },
  { key: 'ally', label: 'Allies' },
  { key: 'kill', label: 'Kill' },
  { key: 'misc', label: 'Misc' },
];

/**
 * Collect card definition IDs contributing to each MP category for a player.
 * Returns a map from category key to array of { defId, mp } entries.
 */
function collectMPCards(
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardsInPlay: readonly { definitionId: CardDefinitionId }[],
  killPile: readonly { definitionId: CardDefinitionId }[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): Record<string, { defId: string; mp: number }[]> {
  const result: Record<string, { defId: string; mp: number }[]> = {
    character: [], item: [], faction: [], ally: [], kill: [], misc: [],
  };

  for (const char of Object.values(characters)) {
    const def = cardPool[char.definitionId as string];
    if (def && 'marshallingPoints' in def) {
      result.character.push({ defId: char.definitionId as string, mp: (def as { marshallingPoints: number }).marshallingPoints });
    }
    for (const item of char.items) {
      const itemDef = cardPool[item.definitionId as string];
      if (itemDef && 'marshallingPoints' in itemDef && 'marshallingCategory' in itemDef) {
        const cat = (itemDef as { marshallingCategory: string }).marshallingCategory;
        result[cat]?.push({ defId: item.definitionId as string, mp: (itemDef as { marshallingPoints: number }).marshallingPoints });
      }
    }
    for (const ally of char.allies) {
      const allyDef = cardPool[ally.definitionId as string];
      if (allyDef && 'marshallingPoints' in allyDef && 'marshallingCategory' in allyDef) {
        const cat = (allyDef as { marshallingCategory: string }).marshallingCategory;
        result[cat]?.push({ defId: ally.definitionId as string, mp: (allyDef as { marshallingPoints: number }).marshallingPoints });
      }
    }
  }

  for (const card of cardsInPlay) {
    const def = cardPool[card.definitionId as string];
    if (def && 'marshallingPoints' in def && 'marshallingCategory' in def) {
      const cat = (def as { marshallingCategory: string }).marshallingCategory;
      result[cat]?.push({ defId: card.definitionId as string, mp: (def as { marshallingPoints: number }).marshallingPoints });
    }
  }

  for (const card of killPile) {
    const def = cardPool[card.definitionId as string];
    if (def && 'killMarshallingPoints' in def) {
      result.kill.push({ defId: card.definitionId as string, mp: (def as { killMarshallingPoints: number }).killMarshallingPoints });
    }
  }

  return result;
}

/**
 * Render the Game Over scoring table on the visual board.
 * Shows MP categories as rows with both players' scores and contributing cards.
 */
export function renderGameOverView(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  if (view.phaseState.phase !== Phase.GameOver) return;

  const board = $('visual-board');
  board.innerHTML = '';

  const selfRaw = view.self.marshallingPoints;
  const oppRaw = view.opponent.marshallingPoints;
  const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);
  const oppAdj = computeTournamentBreakdown(oppRaw, selfRaw);
  const selfTotal = computeTournamentScore(selfRaw, oppRaw);
  const oppTotal = computeTournamentScore(oppRaw, selfRaw);

  const selfCards = collectMPCards(view.self.characters, view.self.cardsInPlay, view.self.killPile, cardPool);
  const oppCards = collectMPCards(view.opponent.characters, view.opponent.cardsInPlay, view.opponent.killPile, cardPool);

  // Table
  const table = document.createElement('table');
  table.className = 'go-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th class="go-cat"></th><th class="go-player">${view.self.name}</th><th class="go-player">${view.opponent.name}</th>`;
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const { key, label } of MP_CATEGORIES) {
    const raw1 = selfRaw[key];
    const adj1 = selfAdj[key];
    const raw2 = oppRaw[key];
    const adj2 = oppAdj[key];

    // Skip categories where both players have 0
    if (raw1 === 0 && raw2 === 0) continue;

    const row = document.createElement('tr');

    // Category label
    const catCell = document.createElement('td');
    catCell.className = 'go-cat';
    catCell.textContent = label;
    row.appendChild(catCell);

    // Self cell
    row.appendChild(buildMPCell(adj1, raw1, selfCards[key], cardPool));

    // Opponent cell
    row.appendChild(buildMPCell(adj2, raw2, oppCards[key], cardPool));

    tbody.appendChild(row);
  }

  table.appendChild(tbody);

  // Total row
  const tfoot = document.createElement('tfoot');
  const totalRow = document.createElement('tr');
  const totalLabel = document.createElement('td');
  totalLabel.className = 'go-cat go-total-label';
  totalLabel.textContent = 'Total';
  totalRow.appendChild(totalLabel);

  const selfTotalCell = document.createElement('td');
  selfTotalCell.className = 'go-score go-total';
  selfTotalCell.textContent = String(selfTotal);
  totalRow.appendChild(selfTotalCell);

  const oppTotalCell = document.createElement('td');
  oppTotalCell.className = 'go-score go-total';
  oppTotalCell.textContent = String(oppTotal);
  totalRow.appendChild(oppTotalCell);

  tfoot.appendChild(totalRow);
  table.appendChild(tfoot);

  board.appendChild(table);
}

/** Build a table cell showing the score and mini card images for one MP category. */
function buildMPCell(
  adjusted: number,
  raw: number,
  cards: { defId: string; mp: number }[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'go-score';

  const scoreSpan = document.createElement('span');
  scoreSpan.className = 'go-score-num';
  scoreSpan.textContent = adjusted !== raw ? `${adjusted} (${raw})` : String(raw);
  cell.appendChild(scoreSpan);

  if (cards.length > 0) {
    const cardRow = document.createElement('div');
    cardRow.className = 'go-cards';
    for (const { defId } of cards) {
      const def = cardPool[defId];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      img.className = 'go-card-img';
      img.dataset.cardId = defId;
      cardRow.appendChild(img);
    }
    cell.appendChild(cardRow);
  }

  return cell;
}
