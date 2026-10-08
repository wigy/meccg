/**
 * @module ai/h2/services/cycling
 *
 * Which cards the end-of-turn cycle must not throw — the strong players' keep
 * rules, as the discard decision reads them.
 *
 * World-class players cycle a card nearly every turn, and the card they throw
 * is chosen by rules the card prices do not express. Raising the prices
 * instead (a held Risky Blow at 2–4 TSD) lifted protection cards over the point
 * cards in every decision those prices feed and cost Elo, so these rules act
 * only where they apply: they mark cards as *kept*, and the discard prices a
 * kept card at its worth plus `cyclingKeepBonus`, so it is never thrown while
 * an unkept card remains.
 *
 * The rules (the project owner's, a strong player):
 * 1. Keep one Marvels Told — every copy once the opponent has shown a
 *    corruption card.
 * 2. Keep one Twilight — every copy once the opponent has shown an
 *    environment.
 * 3. Keep the marshalling-point cards for next turn — one per company — and no
 *    more, since the deck brings more; only a big one (3+ points) may be kept
 *    beyond that.
 * 4. Keep every combat card (a cancel, a strike event, a company combat boost)
 *    unless there are overwhelmingly many (`cyclingCombatCap`).
 * 5. A creature and its boost are held at most a turn — left to the hazard
 *    pricing, which already drops a creature the plan cannot use.
 *
 * Rule 3 ships on. Rules 1, 2 and 4 ship off (`cyclingKeepAnswers`,
 * `cyclingCombatCap`): against the Heuristics-1 agent they cost Elo — it seldom
 * plays corruption or environments and is a weak attacker — and are kept as
 * switches to try against real players.
 */

import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import type { Tunables } from '../core/tunables.js';
import type { CardPrices } from './card-price.js';
import { computeBeliefs } from './beliefs.js';

/** Effect types that protect a company in combat. */
const COMBAT_EFFECTS = new Set([
  'cancel-attack', 'cancel-strike', 'strike-modifier', 'company-combat-boost', 'halve-strikes', 'modify-attack',
  'attack-roll-strikes-fail',
]);

/** A marshalling-point card this big may be kept beyond next turn's need. */
const BIG_MP = 3;

interface Fields {
  readonly name?: string;
  readonly cardType?: string;
  readonly marshallingPoints?: number;
  readonly keywords?: readonly string[];
  readonly effects?: readonly { readonly type?: string }[];
}

/** Whether the opponent has shown a hazard carrying this keyword. */
function opponentShowed(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  keyword: string,
): boolean {
  const beliefs = computeBeliefs(view, cardPool);
  for (const definitionId of beliefs.seen.keys()) {
    const card = cardPool[definitionId] as unknown as Fields | undefined;
    if (card?.cardType?.startsWith('hazard') && (card.keywords ?? []).includes(keyword)) return true;
  }
  return false;
}

/**
 * The instance IDs in hand the cycle keeps.
 *
 * `prices` orders the marshalling-point cards and the combat cards among
 * themselves, so the ones kept are the ones worth most.
 */
export function cyclingKeeps(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  prices: CardPrices,
  tunables: Tunables,
): ReadonlySet<CardInstanceId> {
  const kept = new Set<CardInstanceId>();
  const hand = view.self.hand.map(card => ({
    id: card.instanceId,
    fields: (cardPool[card.definitionId] as unknown as Fields | undefined) ?? {},
    worth: prices.worth(card.instanceId)?.tsd ?? 0,
  }));
  const byWorth = <T extends { worth: number }>(cards: T[]): T[] => [...cards].sort((a, b) => b.worth - a.worth);

  // 1–2. One Marvels Told and one Twilight; every copy once the threat they
  // answer has been shown.
  for (const [name, keyword] of (tunables.cyclingKeepAnswers > 0
    ? [['Marvels Told', 'corruption'], ['Twilight', 'environment']] as const : [])) {
    const copies = hand.filter(c => c.fields.name === name);
    const all = copies.length > 1 && opponentShowed(view, cardPool, keyword);
    copies.slice(0, all ? copies.length : 1).forEach(c => kept.add(c.id));
  }

  // 3. Next turn's marshalling points: one card per company, one more only if
  // it is a big one. A card whose points cannot score — its source stays
  // capped, so it is priced at the floor — is not next turn's points.
  const scoring = byWorth(hand.filter(c => /resource/.test(c.fields.cardType ?? '')
    && (c.fields.marshallingPoints ?? 0) > 0 && c.worth > prices.floor));
  if (tunables.cyclingKeepPoints > 0) {
    const need = Math.max(1, view.self.companies.length);
    scoring.slice(0, need).forEach(c => kept.add(c.id));
    const extra = scoring[need];
    if (extra && (extra.fields.marshallingPoints ?? 0) >= BIG_MP) kept.add(extra.id);
  }

  // 4. Every combat card, unless there are overwhelmingly many.
  const combat = byWorth(hand.filter(c => /resource-event$/.test(c.fields.cardType ?? '')
    && (c.fields.effects ?? []).some(e => COMBAT_EFFECTS.has(e.type ?? ''))));
  combat.slice(0, tunables.cyclingCombatCap).forEach(c => kept.add(c.id));

  return kept;
}
