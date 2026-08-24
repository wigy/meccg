/**
 * @module trophy-offer-targets
 *
 * Pure helpers shared by the combat renderer for the `trophy-offer` phase
 * (MELE §8.37 / CoE 3.IV.1): keying `take-trophy` actions by the character
 * that would receive the trophy, and building the situation-banner text.
 * Kept dependency-free (types only) so both are unit-testable without
 * pulling in the browser render graph.
 */

import type { TakeTrophyAction } from '@meccg/shared';

/**
 * Build a map from character instance ID to the `take-trophy` action that
 * assigns the defeated creature to them. Used by the combat renderer to
 * decide which characters get the clickable "assignable" highlight during
 * the `trophy-offer` phase.
 */
export function buildTakeTrophyMap(actions: readonly TakeTrophyAction[]): Map<string, TakeTrophyAction> {
  const map = new Map<string, TakeTrophyAction>();
  for (const action of actions) {
    map.set(action.characterId as string, action);
  }
  return map;
}

/**
 * Situation-banner text for the `trophy-offer` phase. Distinct from the
 * `body-check` phase text — a defeated creature with no body (e.g.
 * Orc-warband, tw-076) never triggers a body check, so falling back to the
 * body-check banner here misreports what is actually happening.
 */
export function trophyOfferBannerText(racePrefix: string, eligibleCount: number): string {
  return eligibleCount > 0
    ? `${racePrefix}Choose a Trophy — click an eligible character, or Pass to decline`
    : `${racePrefix}No eligible character for a trophy — Pass to continue`;
}
