/**
 * @module state-utils
 *
 * Lightweight utility functions for querying {@link GameState} properties
 * that are used across both server and client packages. Keeps repetitive
 * index look-ups in one place so callers stay concise and consistent.
 */

import type { GameState, MarshallingPointTotals, PlayerId, PlayerState } from './types/index.js';
import { Alignment } from './types/index.js';
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
 * The four MP sources eligible for the doubling rule (Step 3).
 * Kill and miscellaneous are excluded per tournament rules.
 */
const DOUBLING_SOURCES: readonly (keyof MarshallingPointTotals)[] = [
  'character', 'item', 'faction', 'ally',
] as const;

/** All six MP sources. */
const ALL_SOURCES: readonly (keyof MarshallingPointTotals)[] = [
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
  for (const src of ALL_SOURCES) {
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
    const total = ALL_SOURCES.reduce((sum, s) => sum + Math.max(0, adjusted[s]), 0);
    if (total <= 0) break;
    const half = Math.floor(total / 2);
    for (const src of ALL_SOURCES) {
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
  const mp = player.marshallingPoints;
  const rawScore = mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
  const exhaustions = player.deckExhaustionCount;
  return (rawScore >= FREE_COUNCIL_MP_THRESHOLD && exhaustions >= 1) || exhaustions >= 2;
}
