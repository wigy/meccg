/**
 * @module engine/environment-targets
 *
 * Collector for *environment* cards that an environment-canceling card (e.g.
 * Twilight tw-357, Gates of Morning / Doors of Night counters) may target.
 *
 * An environment lives in one of two places at the moment a canceler is
 * declared, and both must be offered:
 *
 * - **In play** — permanent events already resolved onto a player's
 *   `cardsInPlay` (Doors of Night, Gates of Morning, …).
 * - **On the chain** — an environment declared earlier in the *same* chain of
 *   effects but not yet resolved. Canceling it there is what stops it from
 *   ever entering play.
 *
 * Environments are identified by the `environment` keyword on the card
 * definition rather than by card type, since both resource and hazard
 * permanent events can carry it.
 */

import type { GameState, CardInstanceId, CardDefinitionId } from '../index.js';
import { isSetAsideCard } from './set-aside.js';

/** An environment card offered as a cancel target. */
export interface EnvironmentTarget {
  readonly instanceId: CardInstanceId;
  readonly definitionId: string;
}

/** True when the definition's `keywords` array includes the given keyword. */
function hasKeyword(state: GameState, defId: string, keyword: string): boolean {
  const def = state.cardPool[defId as CardDefinitionId];
  return !!def && 'keywords' in def
    && !!(def as { keywords?: readonly string[] }).keywords?.includes(keyword);
}

/**
 * Find every card carrying `keyword` currently in play or declared on the
 * active chain, in declaration order (in-play first, then chain entries).
 *
 * Resolved and negated chain entries are skipped — they can no longer be
 * canceled.
 *
 * @param opts.mayTargetSetAside - When false (the default), in-play cards
 *   placed "off to the side" are excluded: per MEAS §1 they are untargetable
 *   except by cards whose `play-target` declares `targetsSetAside`. Pass the
 *   result of `cardTargetsSetAside(def)` for the declaring card.
 */
export function findKeywordTargets(
  state: GameState,
  keyword: string,
  opts: { mayTargetSetAside?: boolean } = {},
): EnvironmentTarget[] {
  const targets: EnvironmentTarget[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if (isSetAsideCard(card) && !opts.mayTargetSetAside) continue;
      if (hasKeyword(state, card.definitionId as string, keyword)) {
        targets.push({ instanceId: card.instanceId, definitionId: card.definitionId as string });
      }
    }
  }
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.resolved || entry.negated) continue;
      if (!entry.card) continue;
      if (hasKeyword(state, entry.card.definitionId as string, keyword)) {
        targets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
      }
    }
  }
  return targets;
}

/**
 * Find every environment card currently in play or declared on the active
 * chain. See {@link findKeywordTargets} for the shared traversal.
 *
 * @param opts.mayTargetSetAside - When false (the default), in-play cards
 *   placed "off to the side" are excluded: per MEAS §1 they are untargetable
 *   except by cards whose `play-target` declares `targetsSetAside`. Pass the
 *   result of `cardTargetsSetAside(def)` for the declaring card.
 */
export function findEnvironmentTargets(
  state: GameState,
  opts: { mayTargetSetAside?: boolean } = {},
): EnvironmentTarget[] {
  return findKeywordTargets(state, 'environment', opts);
}
