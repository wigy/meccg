/**
 * @module ai/h2/services/attack-value
 *
 * What an attack is worth to the defender if it is beaten.
 *
 * This lives in the service layer because two modules need the same answer and
 * must not compute it privately: `combat` credits the points when a strike
 * completes the attack, and `kill` prices what refusing the attack gives up.
 * If those disagreed, the AI could cancel an attack its own combat model was
 * counting on beating.
 */

import type { CardDefinition, CardInstanceId, CombatState, PlayerView } from '@meccg/shared';

/**
 * Kill MP on offer for defeating this attack, or 0 when there is none.
 *
 * Automatic attacks have no card to claim, detainment creatures are discarded
 * rather than banked (CoE 3.II.3), and a played auto-attack is treated as the
 * site's own attack. Each of those is a case where a naive "defeat the
 * creature, score the points" model would invent income that never arrives.
 */
export function killMpOnOffer(
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  view: PlayerView,
): number {
  if (combat.detainment) return 0;
  const source = combat.attackSource;
  const instanceId = source.type === 'creature' ? source.instanceId
    : source.type === 'on-guard-creature' ? source.cardInstanceId
      : null;
  if (instanceId === null) return 0;

  const definitionId = findDefinitionId(view, instanceId);
  const def = definitionId ? cardPool[definitionId] : undefined;
  const kill = (def as unknown as { killMarshallingPoints?: number } | undefined)?.killMarshallingPoints;
  return typeof kill === 'number' ? kill : 0;
}

/** Definition ID of an instance visible anywhere in the view, if any. */
function findDefinitionId(view: PlayerView, instanceId: CardInstanceId): string | undefined {
  for (const side of [view.self, view.opponent]) {
    for (const card of side.cardsInPlay) {
      if (card.instanceId === instanceId) return card.definitionId;
    }
    for (const character of Object.values(side.characters)) {
      for (const attached of [...character.items, ...character.hazards, ...character.allies]) {
        if (attached.instanceId === instanceId) return attached.definitionId;
      }
    }
  }
  return undefined;
}

