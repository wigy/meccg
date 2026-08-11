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
 * - **A hazard creature** is worth what it contributes to `hazard-plan`: the
 *   standing assignment of every hazard in hand to a company it would be played
 *   against. That is the estimate `hand` was waiting on and the reason §3.5
 *   listed `hazards` as its dependency.
 *
 * The creature price used to be its worth **alone**, against the largest
 * opposing company, and the understatement was visible in the output: the
 * Orc-lieutenant came out at zero because the company could beat it, while
 * `hazards` ranked *playing* it at +3.9% as the opener of a bundle the warband
 * finished. Both answered different questions, and the value of keeping a card
 * is the contribution one, so the plan answers it now — a creature that only
 * works as a follow-up is credited for being one, and one the plan cannot use
 * is worth nothing to hold, which is a real statement about the hand.
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
import { memoizeOnFirst } from '../core/memo.js';
import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import type { MpSource } from '../core/tsd.js';
import type { Tunables } from '../core/tunables.js';
import type { Standing } from './standing.js';
import { computeBudget } from './budget.js';
import { computeHazardPlan } from './hazard-plan.js';

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
  /**
   * What a card would be worth if it arrived — priced from its definition.
   *
   * The question every fetch and every draft pick asks. It is the same
   * valuation, with the one part that needs an instance replaced: a creature
   * already in hand is worth its contribution to the plan, and one on offer is
   * worth what it *would* add to it.
   */
  quote(definitionId: string): CardWorth;
  /** Every card in hand, most valuable first. */
  ranked(): readonly CardWorth[];
  /**
   * The least a card in hand is worth to keep.
   *
   * Not merely the answer for a card the model gave up on: {@link worth}
   * applies it to *every* held card, because the residual it stands for —
   * option value, a play the plan has not found, a future standing where a
   * capped source is no longer capped — belongs to all of them. Without that,
   * a card the model could price and scored at zero ranked below one it could
   * not price at all.
   *
   * {@link quote} deliberately does **not** floor. It answers what a card
   * would be worth if it *arrived*, which is a question about acquisition
   * rather than retention, and no measurement here speaks to it.
   */
  readonly floor: number;
}

/** The suffix that turns 2 into "nd", for a readable play order. */
function ordinal(order: number): string {
  return order === 2 ? 'nd' : order === 3 ? 'rd' : 'th';
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
function buildComputeCardPrices(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): CardPrices {
  const floor = tunables.provisionalCardPrice;
  const budget = computeBudget(view, cardPool);

  const plan = computeHazardPlan(view, cardPool, standing, tunables);
  /** Quotes already computed in this position, by definition ID. */
  const quotes = new Map<string, CardWorth>();

  /**
   * The part of the valuation that needs only the definition.
   *
   * `creatureWorth` is passed in because it is the one branch that differs
   * between a card held and a card offered: held, a creature is worth its
   * contribution to the plan; offered, what it would add to it.
   */
  const priceDefinition = (
    instanceId: CardInstanceId,
    definitionId: string,
    creatureWorth: () => CardWorth,
  ): CardWorth => {
    const def = printed(cardPool[definitionId], definitionId);
    if (!def) {
      return { instanceId, name: definitionId, tsd: floor, reason: 'unknown card — the flat price' };
    }

    if (def.cardType === 'hazard-creature') return creatureWorth();

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

  /**
   * The floor is a **floor**, and it was not being applied as one.
   *
   * A card whose use cannot be modelled at all returned `floor`; a card that
   * *could* be priced and came out at zero returned zero. So an unmodellable
   * hazard event outranked a 2 MP item whose source happened to be capped, and
   * `hand` kept the event and threw the item.
   *
   * That is measurable against the recorded corpus, and it is not subtle. On
   * the discards where a human and the agent both chose to discard, the human
   * threw a resource or hazard *event* 44 times against the agent's 17, and the
   * agent threw a 2 MP hero item **20 times against the human's 3** and an
   * MP-bearing character 13 against 3. Sampled over 200 real discard
   * positions, a source priced at exactly zero in 63 (`character`) and 57
   * (`item`) of them, while every unpriceable event sat at the flat 1.0.
   *
   * The residual the floor stands for — option value, a play the plan has not
   * found, a standing the cap no longer bites in — belongs to *every* card in
   * hand, not only to the ones the model gave up on. Pricing a capped item at
   * zero asserts the opposite: that its value is fully known and is nothing,
   * when playing it is precisely how a capped source stops being capped.
   */
  const atLeastFloor = (worth: CardWorth): CardWorth =>
    (worth.tsd >= floor ? worth : { ...worth, tsd: floor, reason: `${worth.reason}; held at the floor` });

  const worthOf = (instanceId: CardInstanceId): CardWorth | null => {
    const card = view.self.hand.find(c => c.instanceId === instanceId);
    if (!card) return null;
    const definitionId = card.definitionId as string;
    return atLeastFloor(priceDefinition(instanceId, definitionId, () => {
      const def = printed(cardPool[definitionId], definitionId)!;
      const assignment = plan.worth(instanceId);
      // A card is never worth *less* than nothing to hold: the choice not to
      // play it is always available, so a bad creature is worth zero.
      const raw = Math.max(0, assignment?.marginal ?? 0);
      return {
        instanceId,
        name: def.name,
        tsd: raw * tunables.potentialDiscount,
        reason: assignment && assignment.targetCompanyId !== null
          ? `adds ${raw.toFixed(1)} to the plan against their ${assignment.targetLabel}`
            + (assignment.order > 1 ? `, played ${assignment.order}${ordinal(assignment.order)}` : '')
          : `${assignment?.targetLabel ?? 'no company to aim it at'} — worth nothing as an attack`,
      };
    }));
  };

  return {
    floor,
    worth: worthOf,

    quote(definitionId: string): CardWorth {
      // Cached by definition, because one decision can ask for the same quote
      // hundreds of times: the deck-exhaust exchange offers every (discard,
      // sideboard) *pair* as its own candidate — 1008 of them in the captured
      // position — over a few dozen distinct cards. The price cannot differ
      // between two candidates of one position, and the creature branch
      // resolves a whole attack to produce it. Measured on that decision:
      // 110–580 ms without the cache, 29–64 ms with it.
      const cached = quotes.get(definitionId);
      if (cached) return cached;
      const offered = 'offered' as CardInstanceId;
      const quoted = priceDefinition(offered, definitionId, () => {
        const def = printed(cardPool[definitionId], definitionId)!;
        const raw = plan.marginalFor(definitionId);
        return {
          instanceId: offered,
          name: def.name,
          tsd: raw * tunables.potentialDiscount,
          reason: raw > 0
            ? `would add ${raw.toFixed(1)} to the hazard plan`
            : 'the plan has no company left it would improve',
        };
      });
      quotes.set(definitionId, quoted);
      return quoted;
    },
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

/**
 * Build the service, once per position.
 *
 * The registry asks every module about every candidate on a decision and hands
 * them all the same view, so this would otherwise be rebuilt once per
 * candidate for an answer that cannot differ. See `core/memo`.
 */
export const computeCardPrices = memoizeOnFirst(buildComputeCardPrices);
