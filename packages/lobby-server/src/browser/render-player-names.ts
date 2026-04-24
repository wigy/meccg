/**
 * @module render-player-names
 *
 * Renders player names, scores, and general influence in the visual view header.
 * Includes MP breakdown tooltips and GI (general influence) tooltips.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CharacterInPlay, MarshallingPointTotals } from '@meccg/shared';
import { GENERAL_INFLUENCE, isCharacterCard, computeTournamentScore, computeTournamentBreakdown, Phase } from '@meccg/shared';
import { seedDiceFromState, restoreDice, clearDice } from './dice.js';
import { hasRealCards } from './render-debug-panels.js';

/**
 * Build the HTML for the MP breakdown tooltip table.
 * Shows raw and adjusted values per category for both players.
 */
function buildMPTooltip(
  selfName: string,
  selfRaw: MarshallingPointTotals,
  selfAdj: MarshallingPointTotals,
  oppName: string,
  oppRaw: MarshallingPointTotals,
  oppAdj: MarshallingPointTotals,
): string {
  const cats: { key: keyof MarshallingPointTotals; label: string }[] = [
    { key: 'character', label: 'Chars' },
    { key: 'item', label: 'Items' },
    { key: 'faction', label: 'Factions' },
    { key: 'ally', label: 'Allies' },
    { key: 'kill', label: 'Kill' },
    { key: 'misc', label: 'Misc' },
  ];
  const selfTotal = computeTournamentScore(selfRaw, oppRaw);
  const oppTotal = computeTournamentScore(oppRaw, selfRaw);

  let rows = '';
  for (const { key, label } of cats) {
    const s = selfAdj[key] !== selfRaw[key] ? `${selfAdj[key]} (${selfRaw[key]})` : `${selfRaw[key]}`;
    const o = oppAdj[key] !== oppRaw[key] ? `${oppAdj[key]} (${oppRaw[key]})` : `${oppRaw[key]}`;
    rows += `<tr><td class="mp-label">${label}</td><td class="mp-value">${s}</td><td class="mp-value">${o}</td></tr>`;
  }
  return `<table class="mp-tooltip-table">
    <thead><tr><th></th><th>${selfName}</th><th>${oppName}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${selfTotal}</td><td class="mp-value mp-total">${oppTotal}</td></tr></tfoot>
  </table>`;
}

/**
 * Build the HTML for the General Influence tooltip table.
 * Shows each character under general influence with their mind value.
 */
function buildGITooltip(
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; mind: number }[] = [];
  for (const char of Object.values(characters)) {
    if (char.controlledBy !== 'general') continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !('mind' in def) || def.mind === null) continue;
    entries.push({ name: def.name, mind: def.mind });
  }
  entries.sort((a, b) => b.mind - a.mind);

  if (entries.length === 0) return '<div class="gi-tooltip-empty">No characters under GI</div>';
  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.mind}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.mind, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/**
 * Build the GI tooltip for the character draft phase.
 * Uses drafted character definition IDs instead of in-play characters.
 */
function buildDraftGITooltip(
  drafted: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; mind: number }[] = [];
  for (const defId of drafted) {
    const def = cardPool[defId as string];
    if (!def || !isCharacterCard(def)) continue;
    entries.push({ name: def.name, mind: def.mind ?? 0 });
  }
  if (entries.length === 0) return 'No characters drafted';
  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.mind}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.mind, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/** Sum the mind values of drafted characters for GI calculation. */
function sumDraftedMind(drafted: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): number {
  return drafted.reduce((sum, defId) => {
    const def = cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);
}

/** Return movement/hazard limit text once the snapshot has been computed. */
function getHazardLimitLabel(view: PlayerView): string | null {
  if (view.phaseState.phase !== Phase.MovementHazard) return null;
  if (view.phaseState.step === 'set-hazard-limit' || view.phaseState.step === 'reveal-new-site' || view.phaseState.step === 'select-company') {
    return null;
  }
  return String(view.phaseState.hazardLimitAtReveal);
}

/** Render player names and scores in the visual view. */
export function renderPlayerNames(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const isGameOver = view.phaseState.phase === Phase.GameOver;
  document.getElementById('self-deck-box')?.classList.toggle('hidden', isGameOver);
  document.getElementById('opponent-deck-box')?.classList.toggle('hidden', isGameOver);
  const selfEl = document.getElementById('self-name');
  const oppEl = document.getElementById('opponent-name');
  const selfRaw = view.self.marshallingPoints;
  const oppRaw = view.opponent.marshallingPoints;
  const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);
  const oppAdj = computeTournamentBreakdown(oppRaw, selfRaw);
  const selfScore = computeTournamentScore(selfRaw, oppRaw);
  const oppScore = computeTournamentScore(oppRaw, selfRaw);
  const tooltip = buildMPTooltip(view.self.name, selfRaw, selfAdj, view.opponent.name, oppRaw, oppAdj);
  if (selfEl) { selfEl.textContent = view.self.name; selfEl.title = view.self.name; }
  if (oppEl) { oppEl.textContent = view.opponent.name; oppEl.title = view.opponent.name; }

  // During character draft, compute GI from drafted characters instead of in-play characters
  let selfGI: number;
  let oppGI: number;
  let selfGITooltip: string;
  let oppGITooltip: string;
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const selfIdx = hasRealCards(draft.draftState[0].pool) ? 0 : 1;
    const oppIdx = 1 - selfIdx;
    const selfDrafted = draft.draftState[selfIdx].drafted.map(c => c.definitionId);
    const oppDrafted = draft.draftState[oppIdx].drafted.map(c => c.definitionId);
    const selfMind = sumDraftedMind(selfDrafted, cardPool);
    const oppMind = sumDraftedMind(oppDrafted, cardPool);
    selfGI = GENERAL_INFLUENCE - selfMind;
    oppGI = GENERAL_INFLUENCE - oppMind;
    selfGITooltip = buildDraftGITooltip(selfDrafted, cardPool);
    oppGITooltip = buildDraftGITooltip(oppDrafted, cardPool);
  } else {
    selfGI = GENERAL_INFLUENCE - view.self.generalInfluenceUsed;
    oppGI = GENERAL_INFLUENCE - view.opponent.generalInfluenceUsed;
    selfGITooltip = buildGITooltip(view.self.characters, cardPool);
    oppGITooltip = buildGITooltip(view.opponent.characters, cardPool);
  }

  const selfScoreEl = document.getElementById('self-score');
  if (selfScoreEl) {
    selfScoreEl.innerHTML = `<span class="score metric-box"><span class="metric-label">MP</span>${selfScore}<span class="mp-tooltip mp-tooltip--above">${tooltip}</span></span>`
      + `<span class="score metric-box"><span class="metric-label">GI</span>${selfGI}<span class="mp-tooltip mp-tooltip--above">${selfGITooltip}</span></span>`;
  }
  const oppScoreEl = document.getElementById('opponent-score');
  const oppHazardLimitEl = document.getElementById('opponent-hazard-limit');
  const hazardLimit = getHazardLimitLabel(view);
  if (oppScoreEl) {
    oppScoreEl.innerHTML = `<span class="score metric-box"><span class="metric-label">MP</span>${oppScore}<span class="mp-tooltip mp-tooltip--below">${tooltip}</span></span>`
      + `<span class="score metric-box"><span class="metric-label">GI</span>${oppGI}<span class="mp-tooltip mp-tooltip--below">${oppGITooltip}</span></span>`;
  }
  if (oppHazardLimitEl) {
    if (hazardLimit) {
      oppHazardLimitEl.innerHTML = `<span class="metric-label">HL</span>${hazardLimit}`;
      oppHazardLimitEl.classList.remove('hidden');
      const oppScoreRect = oppScoreEl?.getBoundingClientRect();
      const oppDeckRect = document.getElementById('opponent-deck-box')?.getBoundingClientRect();
      if (oppScoreRect && oppDeckRect) {
        oppHazardLimitEl.style.top = `${Math.round(oppScoreRect.top - 48)}px`;
        oppHazardLimitEl.style.left = `${Math.round(oppDeckRect.right + 8)}px`;
      }
    } else {
      oppHazardLimitEl.innerHTML = '';
      oppHazardLimitEl.classList.add('hidden');
    }
  }

  // Seed the dice animation system from game state and restore floating dice
  // if the visual view is active (e.g. after page refresh or load).
  // Clear dice on Game Over so they don't clutter the scoring table.
  if (isGameOver) {
    clearDice();
  } else {
    seedDiceFromState(view);
    const visualView = document.getElementById('visual-view');
    if (visualView && !visualView.classList.contains('hidden')) {
      restoreDice();
    }
  }
}
