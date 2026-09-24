/**
 * @module ai/h2/services/cancel-price
 *
 * What cancelling an attack costs, read off the `cancel-attack` action.
 *
 * The action names exactly what it spends: the card played (absent for a
 * deferred free cancellation), the scout it taps (Concealment), the character
 * it wounds (Escape). Both `combat` and `kill` price the refusal, and both
 * used one flat card whatever was named — so every variant tied, and the agent
 * tapped Galadriel for a Concealment where the human tapped Frodo, and spent a
 * Concealment and a tap where the human played Not at Home, which taps nobody
 * (recorded games mu5omrz8-zsxcp5 and mu5akflh-kjvs5e). One owner for the
 * number keeps the two modules from disagreeing about it.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';
import type { Rationale } from '../core/types.js';
import type { Tunables } from '../core/tunables.js';
import { leaf } from '../core/rationale.js';
import type { CharacterValue } from './character-value.js';

/** The price of a `cancel-attack`, and its parts for a rationale. */
export interface CancelPrice {
  readonly tsd: number;
  readonly parts: readonly Rationale[];
}

/**
 * Price a `cancel-attack` action.
 *
 * `nameOf` turns a character instance into a readable name for the rationale.
 */
export function cancelAttackPrice(
  action: GameAction,
  characterValue: CharacterValue,
  tunables: Tunables,
  nameOf: (instanceId: CardInstanceId) => string,
): CancelPrice {
  const record = action as unknown as {
    scoutInstanceId?: CardInstanceId; targetCharacterId?: CardInstanceId; mode?: string;
  };
  const card = record.mode === 'free-later-cancel' ? 0 : tunables.provisionalCardPrice;
  const tap = record.scoutInstanceId ? characterValue.tapCost(record.scoutInstanceId) : null;
  const wound = record.targetCharacterId ? tunables.woundTempoCost : 0;
  const parts: Rationale[] = [
    leaf('card played', card, {
      unit: 'tsd',
      tunable: 'provisionalCardPrice',
      note: card === 0 ? 'a deferred free cancellation — no card is played' : undefined,
    }),
  ];
  if (tap && record.scoutInstanceId) {
    parts.push(leaf(`taps ${nameOf(record.scoutInstanceId)}`, tap.tsd, { unit: 'tsd', note: tap.reason }));
  }
  if (record.targetCharacterId) {
    parts.push(leaf(`wounds ${nameOf(record.targetCharacterId)}`, wound, { unit: 'tsd', tunable: 'woundTempoCost' }));
  }
  return { tsd: card + (tap?.tsd ?? 0) + wound, parts };
}
