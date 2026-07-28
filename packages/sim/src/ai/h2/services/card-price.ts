/**
 * @module ai/h2/services/card-price
 *
 * §3.5's shadow price: what is a particular card in hand worth keeping?
 *
 * This is the number every module has been charging a placeholder for. One
 * deck holds both hazards and resources, so a card kept as a hazard is a
 * resource not played, and every consumer that spends a card — `combat`
 * cancelling an attack, `factions` risking one on a failed attempt, `hazards`
 * paying for a bundle — has to answer "is this card worth spending?" A flat
 * `provisionalCardPrice` answers it identically for a Cave-drake and a spare
 * Doors of Night, which is wrong in the specific way that matters: it makes
 * every discard decision a coin flip, and the module that owns discards then
 * has nothing to predict.
 *
 * The price is a **reservation value**: what the card is worth if kept and used
 * later, computed from the standing and the board, never from the decision
 * asking about it. Three kinds of card can be priced honestly today:
 *
 * - **A resource with marshalling points** is worth what those points are worth
 *   *in this standing* — through `standing`, so it picks up the doubling and
 *   the diversity cap, and correctly falls to zero in a source already capped.
 * - **A character** is worth its points too, but only if it can be brought into
 *   play at all: a mind that does not fit the free general influence is a card
 *   that cannot be used, whatever it is printed with.
 * - **A hazard creature** is worth what it would deny — the same `denial`
 *   service `hazards` spends, resolved against the opponent's largest company.
 *   That is the estimate `hand` was waiting on and the reason §3.5 listed
 *   `hazards` as its dependency.
 *
 * A creature is priced **alone**, which is a real understatement and visible in
 * the output: the Orc-lieutenant below is priced at zero because the company
 * can beat it, while `hazards` ranks *playing* it at +3.9% as the opener of a
 * bundle the warband finishes. Both are right about different questions, but
 * the value of keeping a card is closer to its bundle contribution than to its
 * solo one, and closing that gap means running the bundle planner from here.
 *
 * Everything else — hazard events, corruption cards, resources that carry no
 * points — falls back to the flat price, and says so. A price with a stated
 * floor is honest; a price that pretends to know is not.
 *
 * All of it is discounted by `potentialDiscount`, because a card in hand is a
 * card that might never be playable. That is the same discount the acquisition
 * modules apply to potential points, deliberately: an unplayed card and an
 * unscored point are the same kind of maybe.
 */

import { CardStatus } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import type { MpSource } from '../core/tsd.js';
import type { Tunables } from '../core/tunables.js';
import type { Standing } from './standing.js';
import { computeBeliefs } from './beliefs.js';
import { computeBudget } from './budget.js';
import { denialContext, denialPricer } from './denial.js';
import { rosterOf } from './strike/prowess.js';
import { resolveAttacks } from './strike/sequence.js';

/** What one card in hand is worth keeping. */
export interface CardWorth {
  /** The hand card. */
  readonly instanceId: CardInstanceId;
  /** Its printed name, for the rationale that spends it. */
  readonly name: string;
  /** Reservation value in TSD — what giving it up costs. */
  readonly tsd: number;
  /** Why it is what it is. */
  readonly reason: string;
}

/** The shadow price of every card in hand. */
export interface CardPrices {
  /** What one card is worth, or null when it is not in hand. */
  worth(instanceId: CardInstanceId): CardWorth | null;
  /** Every card in hand, most valuable first. */
  ranked(): readonly CardWorth[];
  /** What a card whose use cannot be modelled is assumed to be worth. */
  readonly floor: number;
}

/** Card types whose points count as characters. */
const CHARACTER_TYPES = /-character$/;

/** The fields this service reads off a definition. */
interface Printed {
  readonly name: string;
  readonly cardType: string;
  readonly marshallingPoints: number;
  readonly marshallingCategory: MpSource;
  readonly mind: number;
  readonly strikes: number;
  readonly prowess: number;
  readonly body: number | null;
  readonly killMarshallingPoints: number;
}

/** Read the printed fields, defaulted, for a definition. */
function printed(def: CardDefinition | undefined, definitionId: string): Printed | null {
  if (!def) return null;
  const fields = def as unknown as {
    name?: string;
    cardType?: string;
    marshallingPoints?: number;
    marshallingCategory?: string;
    mind?: number;
    strikes?: number;
    prowess?: number;
    body?: number | null;
    killMarshallingPoints?: number;
  };
  return {
    name: fields.name ?? definitionId,
    cardType: fields.cardType ?? '',
    marshallingPoints: fields.marshallingPoints ?? 0,
    marshallingCategory: (fields.marshallingCategory ?? 'misc') as MpSource,
    mind: fields.mind ?? 0,
    strikes: fields.strikes ?? 1,
    prowess: fields.prowess ?? 0,
    body: fields.body ?? null,
    killMarshallingPoints: fields.killMarshallingPoints ?? 0,
  };
}

/**
 * Build the shadow price for every card in hand.
 *
 * The creature valuation is the expensive part — it resolves a whole attack —
 * so it is memoised by definition ID. Two copies of the same creature are worth
 * the same to keep, and a hand of ten cards would otherwise pay for ten
 * enumerations at every discard.
 */
export function computeCardPrices(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): CardPrices {
  const floor = tunables.provisionalCardPrice;
  const budget = computeBudget(view, cardPool);

  // The company a hazard would be aimed at: the biggest one they have, which is
  // the one most worth denying and the one most creatures can be keyed to.
  const target = [...view.opponent.companies]
    .sort((a, b) => b.characters.length - a.characters.length)[0] ?? null;
  const roster = target ? rosterOf(target, view.opponent.characters, cardPool) : [];
  const denial = target
    ? denialContext(view, target, computeBeliefs(view, cardPool), standing, tunables)
    : null;
  const price = denial ? denialPricer(cardPool, standing, tunables, denial) : null;

  const creatureCache = new Map<string, number>();

  /** What a creature would deny if played into the biggest opposing company. */
  const creatureWorth = (definitionId: string, card: Printed): number => {
    if (!price || roster.length === 0) return floor;
    const cached = creatureCache.get(definitionId);
    if (cached !== undefined) return cached;
    const killTsd = card.killMarshallingPoints > 0
      ? standing.tsdAfter({}, { kill: card.killMarshallingPoints }) - standing.tsd
      : 0;
    const result = resolveAttacks(roster, cardPool, [{
      strikeProwess: card.prowess,
      strikes: card.strikes,
      creatureBody: card.body,
      detainment: false,
      bodyCheckModifier: 0,
      killTsd,
    }], price, { maxStates: tunables.attackStateCap });
    const expected = result.outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
    // A card is never worth *less* than nothing to hold: the choice not to play
    // it is always available, so a bad creature is worth zero, not negative.
    const worth = Math.max(0, expected);
    creatureCache.set(definitionId, worth);
    return worth;
  };

  const worthOf = (instanceId: CardInstanceId): CardWorth | null => {
    const card = view.self.hand.find(c => c.instanceId === instanceId);
    if (!card) return null;
    const definitionId = card.definitionId as string;
    const def = printed(cardPool[definitionId], definitionId);
    if (!def) {
      return { instanceId, name: definitionId, tsd: floor, reason: 'unknown card — the flat price' };
    }

    if (def.cardType === 'hazard-creature') {
      const raw = creatureWorth(definitionId, def);
      return {
        instanceId,
        name: def.name,
        tsd: raw * tunables.potentialDiscount,
        reason: raw > 0
          ? `would deny ${raw.toFixed(1)} against their largest company`
          : 'their companies can beat it — worth nothing as an attack',
      };
    }

    if (CHARACTER_TYPES.test(def.cardType)) {
      if (def.mind > budget.freeGeneralInfluence) {
        return {
          instanceId,
          name: def.name,
          tsd: 0,
          reason: `mind ${def.mind} does not fit the ${budget.freeGeneralInfluence} influence free`,
        };
      }
      const gain = def.marshallingPoints > 0
        ? standing.tsdAfter({ character: def.marshallingPoints }) - standing.tsd
        : 0;
      return {
        instanceId,
        name: def.name,
        tsd: gain * tunables.potentialDiscount,
        reason: `${def.marshallingPoints} character MP, mind ${def.mind} inside the influence free`,
      };
    }

    if (def.marshallingPoints > 0) {
      const gain = standing.tsdAfter({ [def.marshallingCategory]: def.marshallingPoints }) - standing.tsd;
      return {
        instanceId,
        name: def.name,
        tsd: gain * tunables.potentialDiscount,
        reason: gain > 0
          ? `${def.marshallingPoints} ${def.marshallingCategory} MP, worth ${gain.toFixed(1)} in this standing`
          : `${def.marshallingPoints} ${def.marshallingCategory} MP — but that source is already capped`,
      };
    }

    return {
      instanceId,
      name: def.name,
      tsd: floor,
      reason: 'no points and no attack to model — the flat price',
    };
  };

  return {
    floor,
    worth: worthOf,
    ranked(): readonly CardWorth[] {
      return view.self.hand
        .map(card => worthOf(card.instanceId))
        .filter((w): w is CardWorth => w !== null)
        .sort((a, b) => b.tsd - a.tsd);
    },
  };
}

/** Untapped characters the opponent still has standing, for callers that report it. */
export function opposingUntapped(view: PlayerView): number {
  let count = 0;
  for (const company of view.opponent.companies) {
    for (const id of company.characters) {
      if (view.opponent.characters[id]?.status === CardStatus.Untapped) count++;
    }
  }
  return count;
}
