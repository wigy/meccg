/**
 * @module state-utils
 *
 * Lightweight utility functions for querying {@link GameState} properties
 * that are used across both server and client packages. Keeps repetitive
 * index look-ups in one place so callers stay concise and consistent.
 */

import type { CardDefinition, Company, GameState, MarshallingPointTotals, PlayerId, PlayerState, SetupStep, SetupStepState, PhaseState } from './types/index.js';
import { Alignment, Phase, Race } from './types/index.js';
import { isCharacterCard } from './types/cards.js';
import { FREE_COUNCIL_MP_THRESHOLD } from './constants.js';

/**
 * Returns the tuple index (0 or 1) of the player with the given ID.
 *
 * Every {@link GameState} stores exactly two players in a fixed-size tuple.
 * This helper centralises the common `state.players[0].id === id ? 0 : 1`
 * look-up that appears throughout the engine and projection layers.
 */
export function getPlayerIndex(state: GameState, playerId: PlayerId): 0 | 1 {
  return state.players[0].id === playerId ? 0 : 1;
}

/**
 * Guard + narrowing for a specific setup step.
 *
 * Every setup-step legal-action computer opens with the same preamble:
 * confirm the game is in the setup phase at the expected step, then look up
 * the acting player's tuple index. This helper collapses that boilerplate
 * into a single call and narrows {@link SetupStepState} to the requested
 * variant so callers can read step-specific fields without a manual cast.
 *
 * Returns `null` when the state is not in the requested setup step, letting
 * the caller bail out early; otherwise returns the narrowed step state
 * together with the acting player's index.
 */
export function setupStepContext<S extends SetupStep>(
  state: GameState,
  playerId: PlayerId,
  step: S,
): { step: Extract<SetupStepState, { step: S }>; playerIndex: 0 | 1 } | null {
  if (state.phaseState.phase !== Phase.Setup || state.phaseState.setupStep.step !== step) return null;
  return {
    step: state.phaseState.setupStep as Extract<SetupStepState, { step: S }>,
    playerIndex: getPlayerIndex(state, playerId),
  };
}

/**
 * Guard + narrowing for the current top-level phase.
 *
 * Phase reducers and their legal-action computers are dispatched by phase, so
 * each opens by reading its own phase-specific state. This replaces the blind
 * `state.phaseState as XPhaseState` cast with a checked narrowing: it returns
 * the {@link PhaseState} member for `phase`, or throws if the game is somehow
 * not in that phase (a routing bug) rather than silently handing back a
 * wrong-typed object whose fields are all `undefined`.
 */
export function requirePhaseState<P extends Phase>(
  state: GameState,
  phase: P,
): Extract<PhaseState, { phase: P }> {
  if (state.phaseState.phase !== phase) {
    throw new Error(
      `requirePhaseState: expected phase '${phase}', but the game is in '${state.phaseState.phase}'`,
    );
  }
  return state.phaseState as Extract<PhaseState, { phase: P }>;
}

/**
 * The four MP sources eligible for the doubling rule (Step 3).
 * Kill and miscellaneous are excluded per tournament rules.
 */
const DOUBLING_SOURCES: readonly (keyof MarshallingPointTotals)[] = [
  'character', 'item', 'faction', 'ally',
] as const;

/**
 * All six marshalling-point sources, in the order the tournament rules
 * list them — which is also the order every scoreboard and MP tooltip
 * displays them in.
 */
export const MP_SOURCES: readonly (keyof MarshallingPointTotals)[] = [
  'character', 'item', 'faction', 'ally', 'kill', 'misc',
] as const;

/**
 * Applies tournament scoring adjustments (CoE rules §10.3, steps 2–4)
 * and returns the adjusted per-source values.
 *
 * **Step 2 — Totaling:** Start with raw values per source.
 *
 * **Step 3 — Doubling:** If the *opponent* has zero or fewer points in a
 * source other than kill or miscellaneous, the player's points in that
 * source are doubled.
 *
 * **Step 4 — Diversity cap:** If more than half of the player's total
 * comes from a single source (ignoring negative sources), that source is
 * reduced until it is no more than half of the player's total.
 *
 * Steps 5–6 (duplicate reveals, avatar-elimination penalty) are
 * interactive or handled separately and are not applied here.
 *
 * @param self     - The player's raw marshalling point totals.
 * @param opponent - The opponent's raw marshalling point totals.
 * @returns The adjusted per-source marshalling point values.
 */
export function computeTournamentBreakdown(
  self: MarshallingPointTotals,
  opponent: MarshallingPointTotals,
): MarshallingPointTotals {
  // Step 2: start with raw values per source
  const adjusted: Record<string, number> = {};
  for (const src of MP_SOURCES) {
    adjusted[src] = self[src];
  }

  // Step 3: double sources where opponent has ≤ 0 (character/item/faction/ally only)
  for (const src of DOUBLING_SOURCES) {
    if (opponent[src] <= 0) {
      adjusted[src] *= 2;
    }
  }

  // Step 4: cap any single source that exceeds half the total.
  // This must iterate because capping one source changes the total, which
  // may cause another source to exceed the new half. We repeat until stable.
  let changed = true;
  while (changed) {
    changed = false;
    const total = MP_SOURCES.reduce((sum, s) => sum + Math.max(0, adjusted[s]), 0);
    if (total <= 0) break;
    const half = Math.floor(total / 2);
    for (const src of MP_SOURCES) {
      if (adjusted[src] > half) {
        adjusted[src] = half;
        changed = true;
      }
    }
  }

  return adjusted as unknown as MarshallingPointTotals;
}

/**
 * Computes a player's total marshalling points using the tournament scoring
 * rules from the Free Council (CoE rules §10.3, steps 2–4).
 *
 * This is a convenience wrapper around {@link computeTournamentBreakdown}
 * that returns just the total.
 *
 * @param self     - The player's raw marshalling point totals.
 * @param opponent - The opponent's raw marshalling point totals.
 * @returns The player's adjusted total marshalling points.
 */
export function computeTournamentScore(
  self: MarshallingPointTotals,
  opponent: MarshallingPointTotals,
): number {
  const b = computeTournamentBreakdown(self, opponent);
  return b.character + b.item + b.faction + b.ally + b.kill + b.misc;
}

/**
 * True if the player's alignment is Ringwraith (Minion) or Balrog.
 *
 * These alignments are forbidden from freely calling the Free Council per
 * CoE rule 10.41 — they must play Sudden Call instead.
 */
export function isMinionOrBalrog(player: PlayerState): boolean {
  return player.alignment === Alignment.Ringwraith || player.alignment === Alignment.Balrog;
}

/**
 * True if the given card definition is the Balrog avatar character (The Balrog,
 * ba-3, or any manifestation thereof). The Balrog is the only avatar
 * (`mind === null`) in a Balrog-alignment deck.
 *
 * Used wherever a MEBA rule applies specifically to The Balrog avatar rather
 * than to every character in a Balrog player's company: he bears but cannot
 * use items (MEBA §item rule), may not use region/starter movement, must enter
 * at The Under-gates, and remaps "Any Dark-hold" home sites.
 */
export function isBalrogAvatarDef(def: CardDefinition | undefined): boolean {
  return isCharacterCard(def) && def.mind === null && def.alignment === Alignment.Balrog;
}

/**
 * The prowess penalty applied when a character stays untapped to face a
 * strike (CoE rule 3.iv.3: normally -3). The Balrog's own card text overrides
 * this to -1 for himself only ("The Balrog's prowess is only modified by -1
 * when not tapping to face a strike").
 */
export function stayUntappedPenalty(def: CardDefinition | undefined): number {
  return isBalrogAvatarDef(def) ? 1 : 3;
}

/**
 * True if the given company contains The Balrog avatar character. Such a
 * company may not use starter or region movement (MEBA §6) and gets a +3
 * roll bonus moving between adjacent Under-deeps sites (his own card text).
 */
export function companyContainsBalrogAvatar(state: GameState, player: PlayerState, company: Company): boolean {
  return company.characters.some(charId => {
    const charData = player.characters[charId];
    if (!charData) return false;
    return isBalrogAvatarDef(state.cardPool[charData.definitionId]);
  });
}

/**
 * True if `def` is a Ringwraith avatar character (mind: null, race: Ringwraith)
 * rather than a Ringwraith follower. Used wherever a rule applies specifically
 * to the avatar rather than to any Ringwraith-aligned character.
 */
export function isRingwraithAvatarDef(def: CardDefinition | undefined): boolean {
  return isCharacterCard(def) && def.mind === null && def.race === Race.Ringwraith;
}

/**
 * True if the given company contains a Ringwraith avatar character (CoE rule
 * 2.II.7.R1). Such a company can only use Starter Movement or Under-deeps
 * Movement — Region Movement is never available, mode or no mode.
 */
export function companyContainsRingwraithAvatar(state: GameState, player: PlayerState, company: Company): boolean {
  return company.characters.some(charId => {
    const charData = player.characters[charId];
    if (!charData) return false;
    return isRingwraithAvatarDef(state.cardPool[charData.definitionId]);
  });
}

/**
 * Sum of all six marshalling-point categories in a player's running total —
 * the player's raw "MP total". Used where a card keys off the whole total
 * rather than a single category (e.g. Out He Sprang ba-71's MP-based region
 * allowance).
 */
export function totalMarshallingPoints(player: PlayerState): number {
  const mp = player.marshallingPoints;
  return mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
}

/**
 * True if the player's alignment is Wizard (Hero) or Fallen-wizard.
 *
 * Both are immune to having Sudden Call played as a hazard against them
 * (CoE rule 10.41 / card text).
 */
export function isWizard(player: PlayerState): boolean {
  return player.alignment === Alignment.Wizard || player.alignment === Alignment.FallenWizard;
}

/**
 * True if the player currently meets the Short ("2-deck") game conditions
 * to call the end of the game (CoE rule 10.40):
 *
 * - At least 25 raw MP AND deck has been exhausted at least once, OR
 * - Deck has been exhausted at least twice.
 *
 * Excludes the per-call gating (`freeCouncilCalled`, `lastTurnFor`) so
 * callers can reuse the threshold check independently — that gating is
 * applied at the legal-action site.
 */
export function canCallEndgameNow(player: PlayerState): boolean {
  const rawScore = callableMarshallingTotal(player);
  const exhaustions = player.deckExhaustionCount;
  return (rawScore >= FREE_COUNCIL_MP_THRESHOLD && exhaustions >= 1) || exhaustions >= 2;
}

/**
 * Sum of the six marshalling-point categories in a {@link MarshallingPointTotals}.
 * Shared by {@link callableMarshallingTotal} and by display code that only has
 * a raw totals object on hand (e.g. a `PlayerView`), not a full `PlayerState`.
 */
export function sumMarshallingPoints(mp: MarshallingPointTotals): number {
  return mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
}

/**
 * Sum of a player's *callable* marshalling-point categories — the raw,
 * unmodified total that CoE rule 10.40 actually compares against the
 * 25-point Short Game calling threshold. This is distinct from the
 * tournament-adjusted score (see {@link computeTournamentBreakdown}) shown
 * for final scoring, which applies doubling/diversity-cap steps that don't
 * apply while merely checking whether the Free Council can be called.
 *
 * MEAS §6e: MPs of companies at an Under-deeps site do not count toward
 * *reaching* the call threshold — use the callable totals, not the full
 * tally. Falls back to the full tally for states constructed before
 * `callableMarshallingPoints` existed.
 */
export function callableMarshallingTotal(player: PlayerState): number {
  return sumMarshallingPoints(player.callableMarshallingPoints ?? player.marshallingPoints);
}
