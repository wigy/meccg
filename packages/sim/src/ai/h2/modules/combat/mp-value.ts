/**
 * @module ai/h2/modules/combat/mp-value
 *
 * What a combat outcome is worth in marshalling points.
 *
 * Three terms H1 does not model at all decide most defensive decisions:
 *
 * - **Losing a character costs its own MP plus whatever it was carrying.** But
 *   not all of it: CoE 3.I.2 lets each unwounded companion salvage one item
 *   from the eliminated character, so the loss is the items that cannot be
 *   rescued — a number derivable from the company, not a guess.
 * - **The opponent gains nothing for killing us.** An eliminated character
 *   goes to its *owner's* out-of-play pile (`eliminateCombatantFromStrike`);
 *   kill MP exists only for defeating creatures. A model that credited the
 *   attacker for a kill would systematically overrate defence.
 * - **We gain kill MP only if every strike of the attack is defeated**
 *   (`combat-finalize.ts`), and never from a detainment attack or a site's
 *   automatic attack. A single parried strike is therefore not income; it is
 *   at most progress toward it.
 *
 * Everything here is read from the player view and the card pool. The engine's
 * own MP recomputation applies alignment clamps and per-card exemptions this
 * module does not reproduce; the resulting approximation is declared in the
 * evaluation's assumptions and is what the calibration harness measures.
 */

import type { CardDefinition, CardInstanceId, CombatState, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import type { MpDelta, MpSource } from '../../core/tsd.js';

/** MP a card is worth, with the source it counts against. */
interface CardMp {
  readonly source: MpSource;
  readonly points: number;
}

/** Printed marshalling points of a definition, or null when it scores none. */
function cardMp(def: CardDefinition | undefined): CardMp | null {
  if (!def) return null;
  const record = def as unknown as { marshallingPoints?: number; marshallingCategory?: string };
  if (typeof record.marshallingPoints !== 'number' || record.marshallingPoints === 0) return null;
  return { source: (record.marshallingCategory ?? 'character') as MpSource, points: record.marshallingPoints };
}

/** Add points to an MP delta in place of the given source. */
function add(delta: Record<string, number>, source: MpSource, points: number): void {
  delta[source] = (delta[source] ?? 0) + points;
}

/** What is lost if a character is eliminated, and why. */
export interface EliminationCost {
  /** Negative MP delta: the character's own points plus unsalvageable items. */
  readonly delta: MpDelta;
  /** The character's own printed MP. */
  readonly characterMp: number;
  /** MP of the items that could not be salvaged. */
  readonly lostItemMp: number;
  /** Items the surviving companions can rescue (CoE 3.I.2). */
  readonly salvageableItems: number;
  /** Items the character carries. */
  readonly carriedItems: number;
}

/**
 * The MP cost of losing a character mid-combat.
 *
 * Item salvage is the part worth getting right: each unwounded companion may
 * take one item, so a character in a healthy company loses far less than the
 * same character standing alone. Companions rescue the most valuable items
 * first, which is what makes the *cheapest* items the ones that are lost.
 */
export function eliminationCost(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  characterId: CardInstanceId,
  companyCharacterIds: readonly CardInstanceId[],
): EliminationCost {
  const character = view.self.characters[characterId];
  const delta: Record<string, number> = {};
  if (!character) {
    return { delta, characterMp: 0, lostItemMp: 0, salvageableItems: 0, carriedItems: 0 };
  }

  const own = cardMp(cardPool[character.definitionId]);
  if (own) add(delta, own.source, -own.points);

  const items = character.items
    .map(item => ({ item, mp: cardMp(cardPool[item.definitionId]) }))
    .sort((a, b) => (b.mp?.points ?? 0) - (a.mp?.points ?? 0));

  // CoE 3.I.2: one item each, and only from companions who are not themselves
  // wounded. The dying character obviously cannot rescue its own belongings.
  const rescuers = companyCharacterIds.filter(id => {
    if (id === characterId) return false;
    const companion = view.self.characters[id];
    return companion !== undefined && companion.status !== CardStatus.Inverted;
  }).length;

  let lostItemMp = 0;
  for (const { mp } of items.slice(rescuers)) {
    if (!mp) continue;
    add(delta, mp.source, -mp.points);
    lostItemMp += mp.points;
  }

  return {
    delta,
    characterMp: own?.points ?? 0,
    lostItemMp,
    salvageableItems: Math.min(rescuers, items.length),
    carriedItems: items.length,
  };
}

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

/**
 * Whether defeating this strike would complete the attack — every other strike
 * is already defeated and none remain unresolved.
 *
 * Kill MP is all-or-nothing per `combat-finalize.ts`, so this is the
 * difference between banking the points now and merely keeping the
 * possibility alive.
 */
export function strikeCompletesTheAttack(combat: CombatState): boolean {
  return combat.strikeAssignments.every((assignment, index) => {
    if (index === combat.currentStrikeIndex) return true;
    return assignment.resolved && assignment.result === 'success';
  });
}

/**
 * Whether the attack can still be defeated at all: no already-resolved strike
 * ended in anything other than a defeat. Once one strike has got through, the
 * creature is going to the attacker's discard pile whatever happens next, and
 * the kill MP term must drop to zero rather than lingering as optimism.
 */
export function attackStillDefeatable(combat: CombatState): boolean {
  return combat.strikeAssignments.every((assignment, index) =>
    index === combat.currentStrikeIndex || !assignment.resolved || assignment.result === 'success');
}
