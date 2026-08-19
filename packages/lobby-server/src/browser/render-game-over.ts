/**
 * @module render-game-over
 *
 * Renders the Game Over scoring table on the visual board.
 * Shows marshalling point categories as rows with both players' scores
 * and the contributing cards displayed as mini card images.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CharacterInPlay } from '@meccg/shared';
import { cardImageProxyPath, computeTournamentBreakdown, isItemCard, Phase } from '@meccg/shared';
import { $ } from './render-utils.js';
import { mpCategories } from './mp-categories.js';


/**
 * Collect card definition IDs contributing to each MP category for a player.
 * Returns a map from category key to array of { defId, mp } entries.
 */
export function collectMPCards(
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
    if (!def) continue;
    // Stored items have a storable-at effect that overrides or provides MP.
    const storableEffect = (def as { effects?: { type: string; marshallingPoints?: number }[] }).effects?.find(
      (e: { type: string }) => e.type === 'storable-at',
    ) as { type: string; marshallingPoints?: number } | undefined;
    if (storableEffect) {
      const mp = storableEffect.marshallingPoints ?? (('marshallingPoints' in def) ? (def as { marshallingPoints: number }).marshallingPoints : 0);
      const cat = ('marshallingCategory' in def) ? (def as { marshallingCategory: string }).marshallingCategory : 'misc';
      result[cat]?.push({ defId: card.definitionId as string, mp });
      continue;
    }
    // Regular items (CoE rule 2.II.4): storable at any Haven without a
    // `storable-at` effect on the card — still score their printed MP once
    // stored, same as recompute-derived's addItemMP fallback.
    if (isItemCard(def)) {
      result[def.marshallingCategory]?.push({ defId: card.definitionId as string, mp: def.marshallingPoints });
      continue;
    }
    if ('killMarshallingPoints' in def) {
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

  // One Ring win banner — a forced win bypasses the scoring table as the
  // decider, so call it out explicitly (CoE rule 10.39 / MELE §1).
  const goState = view.phaseState;
  if (goState.winReason.kind === 'one-ring') {
    const winnerName = goState.winner === view.self.id ? view.self.name
      : goState.winner === view.opponent.id ? view.opponent.name
      : '?';
    const cardId = goState.winReason.card;
    const cardDef = cardId ? cardPool[cardId as string] : undefined;
    const via = cardDef ? ` (${cardDef.name})` : '';
    const banner = document.createElement('div');
    banner.className = 'go-onering-banner';
    banner.textContent = `${winnerName} wins with The One Ring${via}`;
    board.appendChild(banner);
  }

  const selfRaw = view.self.marshallingPoints;
  const oppRaw = view.opponent.marshallingPoints;
  const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);
  const oppAdj = computeTournamentBreakdown(oppRaw, selfRaw);
  // The Total row must reflect the authoritative finalScores from the reducer
  // (CoE 10.3.v unique-card-reveal penalty included), not a fresh
  // computeTournamentScore() call — that only covers steps 2-4 and would
  // silently drop the -1-per-match reveal penalty from the displayed total.
  const selfTotal = goState.finalScores[view.self.id];
  const oppTotal = goState.finalScores[view.opponent.id];

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

  for (const { key, label } of mpCategories('long')) {
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
