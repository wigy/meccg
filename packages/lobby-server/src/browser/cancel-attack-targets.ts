/**
 * @module cancel-attack-targets
 *
 * Pure helpers shared by the combat renderer for `cancel-attack` targeting:
 * collecting in-play tap-to-cancel hosts, and grouping a selected hand card's
 * scout-targeted actions by scout. Kept dependency-free (types only) so both
 * are unit-testable without pulling in the browser render graph.
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

/**
 * Group the selected hand card's `cancel-attack` actions by scout character
 * instance ID. A dual-mode card (e.g. The Tormented Earth: "Cancels the
 * attack or gives the attack -3 prowess, your choice") is offered as two
 * separate actions naming the same scout — one per mode. Grouping into a list
 * (rather than keeping only the last action seen per scout) preserves every
 * mode so the combat view can let the player choose, instead of one mode
 * silently overwriting the other in a single-action map.
 */
export function groupCancelAttackActionsByScout<
  T extends { readonly cardInstanceId: CardInstanceId; readonly scoutInstanceId?: CardInstanceId },
>(actions: readonly T[], selectedCardInstanceId: CardInstanceId): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const action of actions) {
    if (action.cardInstanceId !== selectedCardInstanceId || !action.scoutInstanceId) continue;
    const list = map.get(action.scoutInstanceId as string) ?? [];
    list.push(action);
    map.set(action.scoutInstanceId as string, list);
  }
  return map;
}
