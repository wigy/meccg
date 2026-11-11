/**
 * @module set-aside-item-play
 *
 * Board affordance for items played from a set-aside slot rather than from
 * hand — chiefly Armory (dm-116): "When you otherwise would be allowed to play
 * a minor item from your hand at a Border-hold, Free-hold, or Haven, you may
 * play an item from under Armory instead." The engine offers these as
 * `play-hero-resource` actions with `fromSetAside: true`, one per eligible
 * bearer, keyed by the set-aside item's own instance ID. The item lives in
 * `cardsInPlay` (under its host), not in hand, so the hand arc never sees it;
 * the in-play card renderer uses {@link findSetAsideItemPlayActions} to make
 * the stored card clickable and feed it into the ordinary two-step
 * resource-play character targeting.
 */

import type { CardInstanceId, GameAction, PlayHeroResourceAction } from '@meccg/shared';

/**
 * Every legal `play-hero-resource` action that plays the given set-aside
 * card (`fromSetAside: true`) — one entry per eligible bearer.
 */
export function findSetAsideItemPlayActions(
  legalActions: readonly GameAction[],
  instanceId: CardInstanceId,
): PlayHeroResourceAction[] {
  return legalActions.filter(
    (a): a is PlayHeroResourceAction => a.type === 'play-hero-resource'
      && a.cardInstanceId === instanceId
      && a.fromSetAside === true,
  );
}
