/**
 * @module render-player-names
 *
 * Renders player names, scores, and general influence in the visual view header.
 * Includes MP breakdown tooltips and GI (general influence) tooltips.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CharacterInPlay, CardInPlay, CardEffect } from '@meccg/shared';
import { GENERAL_INFLUENCE, isCharacterCard, computeTournamentScore, computeTournamentBreakdown, Phase, effectiveHazardLimit } from '@meccg/shared';
import { seedDiceFromState, restoreDice, clearDice } from './dice.js';
import { hasRealCards } from './render-debug-panels.js';
import { buildMPTooltip } from './mp-categories.js';


/**
 * Influence-to-control cost override carried by a character via an attached
 * `control-restriction` effect (a resource permanent-event played on the
 * character, e.g. Wizard's Myrmidon wh-84 → cost 3). Mirrors the engine's
 * `controlCostOf`: when present, this `cost` replaces the bearer's mind for
 * influence-to-control accounting. Returns `undefined` when no such override is
 * attached. Resolves item definitions from the card pool by `definitionId` so it
 * works against the redacted player view (no game state required).
 */
function controlRestrictionCost(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): number | undefined {
  for (const item of char.items) {
    const def = cardPool[item.definitionId as string];
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
    if (!effects) continue;
    for (const e of effects) {
      if (e.type === 'control-restriction' && typeof e.cost === 'number') return e.cost;
    }
  }
  return undefined;
}

/**
 * True when the character bears an attached card (stored in its `items`, where a
 * resource permanent-event played "on a character" is kept) carrying a
 * `general-influence-exempt` effect — the continuous marker placed by *Await the
 * Advent of Allies* (dm-117), whose CRF 22 erratum reads "Target character does
 * not count against general influence." Mirrors the engine's
 * `characterBearsAttachedEffect` (reducer-utils), which is what actually removes
 * the bearer's mind from the GI pool; the tooltip must skip the same characters
 * so its total matches the engine's GI calculation. Detected by effect type —
 * not card id — so any future card carrying the marker works unchanged. Resolves
 * item definitions from the card pool by `definitionId` so it works against the
 * redacted player view (no game state required).
 */
function bearsGeneralInfluenceExempt(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  for (const item of char.items) {
    const def = cardPool[item.definitionId as string];
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
    if (effects?.some(e => e.type === 'general-influence-exempt')) return true;
  }
  return false;
}

/**
 * Build the HTML for the General Influence tooltip table, as a ledger:
 * the first row is the player's GI pool, one `−mind` row follows per
 * character under general influence, and the last row is the free GI left —
 * matching the GI number shown in the metric box.
 *
 * The pool is the engine-computed `generalInfluence` from the player view —
 * 20 for most players, a revealed Fallen-wizard avatar's white-hand value
 * (which grows with stage resources, MEWH §1), already folding any in-play
 * bonus such as *Bade to Rule* le-167's +5 — never the raw constant.
 *
 * Each character row shows the cost actually counted against GI. A
 * `control-restriction` override (e.g. Wizard's Myrmidon, which makes its
 * bearer require only 3 influence to control) replaces the bearer's mind —
 * matching the engine's GI accounting. Otherwise the effective mind is used.
 * When the counted cost differs from the printed mind (a stat-modifier or a
 * control-restriction override), the printed mind is shown in parentheses —
 * mirroring the MP breakdown's `adjusted (raw)` format. A character bearing
 * *Await the Advent of Allies* (dm-117) "does not count against general
 * influence" (CRF 22) and is omitted entirely, matching the engine.
 */
export function buildGITooltip(
  giPool: number,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; mind: number; raw: number }[] = [];
  for (const char of Object.values(characters)) {
    if (char.controlledBy !== 'general' || char.influenceUnsubtracted) continue;
    // Await the Advent of Allies (dm-117): the bearer "does not count against
    // general influence" (CRF 22), so the engine drops its mind from the pool.
    // Skip it here too, or the tooltip total would exceed the engine's GI.
    if (bearsGeneralInfluenceExempt(char, cardPool)) continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !('mind' in def) || def.mind === null) continue;
    const mind = controlRestrictionCost(char, cardPool) ?? char.effectiveStats.mind ?? def.mind;
    entries.push({ name: def.name, mind, raw: def.mind });
  }
  entries.sort((a, b) => b.mind - a.mind);
  return buildGILedger(giPool, entries);
}

/**
 * Render the GI ledger table shared by the in-play and draft tooltips:
 * pool row, one `−cost` row per entry (printed value in parentheses when it
 * differs), and a closing "Free" row of what remains.
 */
function buildGILedger(
  giPool: number,
  entries: readonly { name: string; mind: number; raw?: number }[],
): string {
  let rows = `<tr><td class="mp-label">General influence</td><td class="mp-value">${giPool}</td></tr>`;
  for (const e of entries) {
    const value = e.raw !== undefined && e.mind !== e.raw ? `−${e.mind} (${e.raw})` : `−${e.mind}`;
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${value}</td></tr>`;
  }
  const used = entries.reduce((sum, e) => sum + e.mind, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Free</td><td class="mp-value mp-total">${giPool - used}</td></tr></tfoot>
  </table>`;
}

/**
 * Total stage points printed on a card definition (MEWH §1): the sum of its
 * `stage-points` effect values. Mirrors the engine's `stagePointsOfCard`, but
 * reads the definition's effects directly so it works against the redacted
 * player view (no game state required). Returns 0 for cards with no such effect.
 */
function stagePointsOfDef(def: CardDefinition | undefined): number {
  const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
  if (!effects) return 0;
  let total = 0;
  for (const e of effects) {
    if (e.type === 'stage-points' && typeof e.value === 'number') total += e.value;
  }
  return total;
}

/**
 * Build the HTML for the Stage-points (SP) breakdown tooltip table.
 * Lists each in-play card contributing stage points and the amount it adds,
 * matching the engine's Fallen-wizard SP accounting (MEWH §1): stage
 * permanent-events sit in `cardsInPlay`, while a stage event played "on a
 * character" (Wizard's Myrmidon wh-84, The Forge-master wh-117) is attached to
 * the bearer's `items`, so both sources are summed.
 */
export function buildSPTooltip(
  cardsInPlay: readonly CardInPlay[],
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; points: number }[] = [];
  for (const card of cardsInPlay) {
    const def = cardPool[card.definitionId as string];
    const points = stagePointsOfDef(def);
    if (def && points !== 0) entries.push({ name: def.name, points });
  }
  for (const char of Object.values(characters)) {
    for (const item of char.items) {
      const def = cardPool[item.definitionId as string];
      const points = stagePointsOfDef(def);
      if (def && points !== 0) entries.push({ name: def.name, points });
    }
  }
  entries.sort((a, b) => b.points - a.points);

  if (entries.length === 0) return '<div class="gi-tooltip-empty">No stage resources in play</div>';
  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.points}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.points, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/**
 * Build the SP tooltip for the character draft phase.
 * During the draft a Fallen-wizard's stage resources are not yet in play; they
 * are tracked in `draftedStageResources` but already count toward the running
 * stage-point total (MEWH §1 / CoE 1.7.F1), so list them from there.
 */
function buildDraftSPTooltip(
  draftedStageResources: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; points: number }[] = [];
  for (const defId of draftedStageResources) {
    const def = cardPool[defId as string];
    const points = stagePointsOfDef(def);
    if (def && points !== 0) entries.push({ name: def.name, points });
  }
  if (entries.length === 0) return '<div class="gi-tooltip-empty">No stage resources drafted</div>';
  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.points}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.points, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/**
 * Build the GI tooltip for the character draft phase, in the same ledger
 * format as {@link buildGITooltip}: pool first, `−mind` per drafted
 * character, free GI last. Uses drafted character definition IDs instead of
 * in-play characters; during the draft the pool is always the base constant
 * (no avatar or stage resources are revealed yet).
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
  return buildGILedger(GENERAL_INFLUENCE, entries);
}

/** Sum the mind values of drafted characters for GI calculation. */
function sumDraftedMind(drafted: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): number {
  return drafted.reduce((sum, defId) => {
    const def = cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);
}

/**
 * Remaining general influence for a player, once in play: the effective pool
 * (`generalInfluence` — 20 for most players, or a revealed Fallen-wizard
 * avatar's white-hand value, already folding in any in-play bonus such as
 * *Bade to Rule* le-167's +5, CoE 1.12.R1) minus GI committed to controlling
 * characters (`generalInfluenceUsed`). Reading the raw `GENERAL_INFLUENCE`
 * constant here instead of `generalInfluence` would silently drop any such
 * bonus from the displayed total.
 */
export function remainingGeneralInfluence(player: { generalInfluence: number; generalInfluenceUsed: number }): number {
  return player.generalInfluence - player.generalInfluenceUsed;
}

/**
 * Return movement/hazard limit text once the snapshot has been computed.
 *
 * The displayed limit must reflect the *effective* limit for the active
 * company, not just the at-reveal snapshot: a Dragon "At Home" discard (e.g.
 * Daelomin at Home td-11) adds a mid-phase `hazard-limit-modifier` constraint
 * that {@link effectiveHazardLimit} folds in. Reading `hazardLimitAtReveal`
 * alone left the remaining count unchanged after such a boost.
 *
 * Exported for regression testing.
 */
export function getHazardLimitLabel(view: PlayerView): string | null {
  if (view.phaseState.phase !== Phase.MovementHazard) return null;
  if (view.phaseState.step === 'set-hazard-limit' || view.phaseState.step === 'reveal-new-site' || view.phaseState.step === 'select-company') {
    return null;
  }
  const selfIsResource = view.activePlayer === view.self.id;
  const resourceCompanies = selfIsResource ? view.self.companies : view.opponent.companies;
  const activeCompany = resourceCompanies[view.phaseState.activeCompanyIndex];
  const limit = activeCompany
    ? effectiveHazardLimit(
        view.activeConstraints,
        view.phaseState.hazardLimitAtReveal,
        view.phaseState.preRevealHazardLimitConstraintIds,
        activeCompany.id,
      )
    : view.phaseState.hazardLimitAtReveal;
  const remaining = limit - view.phaseState.hazardsPlayedThisCompany;
  return String(Math.max(0, remaining));
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

  // Highlight the name of the player whose turn it currently is.
  const selfActive = !isGameOver && view.activePlayer === view.self.id;
  const oppActive = !isGameOver && view.activePlayer === view.opponent.id;
  selfEl?.classList.toggle('player-label--active', selfActive);
  oppEl?.classList.toggle('player-label--active', oppActive);

  // During character draft, compute GI from drafted characters instead of in-play characters
  let selfGI: number;
  let oppGI: number;
  let selfGITooltip: string;
  let oppGITooltip: string;
  let selfSPTooltip: string;
  let oppSPTooltip: string;
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
    selfSPTooltip = buildDraftSPTooltip(draft.draftState[selfIdx].draftedStageResources.map(c => c.definitionId), cardPool);
    oppSPTooltip = buildDraftSPTooltip(draft.draftState[oppIdx].draftedStageResources.map(c => c.definitionId), cardPool);
  } else {
    selfGI = remainingGeneralInfluence(view.self);
    oppGI = remainingGeneralInfluence(view.opponent);
    selfGITooltip = buildGITooltip(view.self.generalInfluence, view.self.characters, cardPool);
    oppGITooltip = buildGITooltip(view.opponent.generalInfluence, view.opponent.characters, cardPool);
    selfSPTooltip = buildSPTooltip(view.self.cardsInPlay, view.self.characters, cardPool);
    oppSPTooltip = buildSPTooltip(view.opponent.cardsInPlay, view.opponent.characters, cardPool);
  }

  // Populate the individual metric cells (MP / GI / SP). The dice tray is a
  // sibling cell in the same 2×2 grid (dice under MP, SP under GI) and is
  // managed separately by the dice module, so we must not rewrite the whole
  // container — only the inner content of each metric box.
  const selfMpEl = document.getElementById('self-mp');
  if (selfMpEl) selfMpEl.innerHTML = `<span class="metric-label">MP</span>${selfScore}<span class="mp-tooltip mp-tooltip--above">${tooltip}</span>`;
  const selfGiEl = document.getElementById('self-gi');
  if (selfGiEl) selfGiEl.innerHTML = `<span class="metric-label">GI</span>${selfGI}<span class="mp-tooltip mp-tooltip--above">${selfGITooltip}</span>`;
  const selfSpEl = document.getElementById('self-sp');
  const selfIsFW = view.self.alignment === 'fallen-wizard';
  const selfSP = selfIsFW ? String(view.self.stagePoints) : '–';
  if (selfSpEl) selfSpEl.innerHTML = `<span class="metric-label">SP</span>${selfSP}${selfIsFW ? `<span class="mp-tooltip mp-tooltip--above">${selfSPTooltip}</span>` : ''}`;

  const oppScoreEl = document.getElementById('opponent-score');
  const oppHazardLimitEl = document.getElementById('opponent-hazard-limit');
  const hazardLimit = getHazardLimitLabel(view);
  const oppMpEl = document.getElementById('opponent-mp');
  if (oppMpEl) oppMpEl.innerHTML = `<span class="metric-label">MP</span>${oppScore}<span class="mp-tooltip mp-tooltip--below">${tooltip}</span>`;
  const oppGiEl = document.getElementById('opponent-gi');
  if (oppGiEl) oppGiEl.innerHTML = `<span class="metric-label">GI</span>${oppGI}<span class="mp-tooltip mp-tooltip--below">${oppGITooltip}</span>`;
  const oppSpEl = document.getElementById('opponent-sp');
  const oppIsFW = view.opponent.alignment === 'fallen-wizard';
  const oppSP = oppIsFW ? String(view.opponent.stagePoints) : '–';
  if (oppSpEl) oppSpEl.innerHTML = `<span class="metric-label">SP</span>${oppSP}${oppIsFW ? `<span class="mp-tooltip mp-tooltip--below">${oppSPTooltip}</span>` : ''}`;
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
