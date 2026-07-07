/**
 * @module cancel-attack-targets
 *
 * Pure helper shared by the combat renderer: given a defending company's
 * characters (with their equipped items and allies), collect the instance IDs of
 * every in-play card that can host a direct tap-to-cancel `cancel-attack`
 * ability. Kept dependency-free (types only) so it is unit-testable without
 * pulling in the browser render graph.
 */

import type { CardInstanceId } from '@meccg/shared';

/**
 * Collect the instance IDs of every in-play card in a defending company that can
 * host a direct tap-to-cancel `cancel-attack` ability: the company's characters,
 * their equipped **items** (e.g. Torque of Hues, Helm of Fear, Star-glass), and
 * their allies (e.g. Goldberry). These IDs distinguish in-play cancel-attack
 * actions (whose `cardInstanceId` is a board card) from hand-card cancel-attack
 * effects (short events like Concealment), which render from the hand instead.
 *
 * Items were previously omitted, so an item's `cancel-attack` action never landed
 * in the combat view's `cancelAttackInPlayMap` and the item stayed unclickable —
 * the player could not tap Torque of Hues to cancel an automatic attack (or any
 * attack) at all.
 */
export function inPlayCancelAttackIds(
  characters: readonly CardInstanceId[],
  charMap: Record<string, {
    readonly items: readonly { readonly instanceId: CardInstanceId }[];
    readonly allies: readonly { readonly instanceId: CardInstanceId }[];
  }>,
): Set<string> {
  const ids = new Set<string>();
  for (const charId of characters) {
    ids.add(charId as string);
    const char = charMap[charId as string];
    if (!char) continue;
    for (const item of char.items) {
      ids.add(item.instanceId as string);
    }
    for (const ally of char.allies) {
      ids.add(ally.instanceId as string);
    }
  }
  return ids;
}
