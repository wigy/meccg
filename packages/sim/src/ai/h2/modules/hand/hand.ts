/**
 * @module ai/h2/modules/hand/hand
 *
 * The `hand` module — the sideboard exchange, and the card price it does not
 * yet compute.
 *
 * Plan §3.5 makes the case for this module at length, and the case is about a
 * *price*: one deck holds both hazards and resources, so every card kept as a
 * hazard is a resource not played. Every other module already faces the
 * question "is this card worth spending?" — `combat` when it decides whether
 * to cancel an attack, `factions` when an attempt discards the card on a
 * failure — and if each answers privately they will answer inconsistently.
 * That inconsistency is how the weight soup came about.
 *
 * That price now exists. It was blocked on `hazards`, exactly as §3.5 said it
 * would be — a card's reservation value depends on what the hazard side expects
 * to need, and nothing could estimate that until the denial model did. The
 * `card-price` service prices a resource by the points it would score in this
 * standing, a character by whether its mind even fits the influence free, and a
 * creature by what it would deny against the opponent's largest company.
 *
 * The difference that makes to *this* module is the whole reason to care.
 * Before it, every `discard-card` action scored identically, so the module had
 * no opinion about which card to throw — and the horizon test said so, with a
 * correlation of -0.02 over a thousand predictions. A module whose predictions
 * do not vary cannot be right about anything.
 *
 * This module also owns **sideboard access**, and that used to be scored at a
 * flat zero on the grounds that no marshalling point moves. True, and beside the
 * point: the cost of reaching into a sideboard is never measured in points, and
 * both variants publish exactly what it is.
 *
 * - The resource player **taps their avatar** (CoE 2.II.6, and the action names
 *   him), so the cost is what `character-value` says that tap forfeits — which
 *   is far more than the flat tempo when he is the company's best influencer.
 * - The hazard player pays with **half the hazard limit**: `snapshotHazardLimit`
 *   halves it, rounding up, for every company in the coming movement/hazard
 *   phase. `hazard-plan` prices that directly by re-running its allocation
 *   against halved limits — the cost is the denial the hand can no longer do.
 *
 * The gain is the best card the sideboard could supply, at the same `quote` a
 * fetch uses, discounted for how far from playable it lands: a card shuffled
 * into the play deck must still be drawn, and one sent to the discard pile waits
 * for the deck to run out first. Both use `potentialDiscount`, once and twice
 * respectively, so no new constant is invented for the distance.
 *
 * It was the largest **flat** decision left in the game — 72 contested decisions
 * in three self-play games where every candidate tied at zero and the whole
 * thing went to Heuristics 1, which is not an opinion but the absence of one.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';
import { namedCharacter } from '../../core/action-fields.js';
import { computeCardPrices } from '../../services/card-price.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { computeHazardPlan } from '../../services/hazard-plan.js';
import type { Plan, PlanStep } from '../../core/plan.js';
import { CARD_STEP } from '../../core/plan.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'start-sideboard-to-deck',
  'start-sideboard-to-discard',
  // The Nazgûl variants (CoE 5.24): the same exchange, moving hazards rather
  // than resources. Both went unowned purely because the action types have
  // different names — the `-to-discard` one for 46 decisions in three games and
  // the `-to-deck` one for 41, and the second was missed when the first was
  // fixed because the report lists them separately.
  'start-hazard-sideboard-to-discard',
  'start-hazard-sideboard-to-deck',
  // §3.5 names these as the module's own: the end-of-turn discard and the
  // draw that refills the hand. They are also the most common candidates in
  // the game with no owner — `discard-card` alone appears in more contested
  // decisions than any action but `pass`.
  'discard-card',
  'draw-cards',
] as const;

/** Assumptions every hand evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the card price values a creature by what it would deny against their *largest* company, which '
  + 'is a stand-in for the company it would actually be keyed to',
  'other consumers still charge the flat `provisionalCardPrice` when they spend a card: `combat` '
  + 'and `factions` have not been moved onto the priced service yet',
];

/** Assumptions specific to reaching into a sideboard. */
const SIDEBOARD_ASSUMPTIONS: readonly string[] = [
  'the fetch is priced by the best card the sideboard holds, assuming it can be taken — the '
  + 'engine\'s own filter on what this variant may fetch is approximated by card type alone',
  'only the *best* card is priced even where five may be taken, because a second card\'s worth '
  + 'depends on the plan the first one changes; the five-card variant is understated, not guessed',
  'a card landing in the play deck or the discard is discounted for the distance with '
  + '`potentialDiscount`, once and twice — a stand-in for the chance of ever drawing it, not a '
  + 'model of the deck',
  'the halved hazard limit is priced against the hazards *now in hand*: the plan cannot know what '
  + 'the coming turn will draw, so a hand with nothing to spend prices the loss at nothing',
];

/**
 * The four ways into a sideboard, and what each one costs and reaches.
 *
 * `hazard` is the untap access of CoE 2.I, which the hazard player pays for with
 * half the coming hazard limit; the other two are the resource player's avatar
 * tap of CoE 2.II.6. `steps` is how far from playable the fetched card lands —
 * one for the play deck, two for the discard pile, which is only reached once
 * the deck runs out.
 */
const SIDEBOARD_ACCESS: Readonly<Record<string, {
  readonly seat: 'hazard' | 'resource';
  readonly steps: number;
  readonly cards: number;
  readonly where: string;
}>> = {
  'start-sideboard-to-deck': { seat: 'resource', steps: 1, cards: 1, where: 'play deck' },
  'start-sideboard-to-discard': { seat: 'resource', steps: 2, cards: 5, where: 'discard pile' },
  'start-hazard-sideboard-to-deck': { seat: 'hazard', steps: 1, cards: 1, where: 'play deck' },
  'start-hazard-sideboard-to-discard': { seat: 'hazard', steps: 2, cards: 5, where: 'discard pile' },
};

/** Whether a definition is a hazard, which is what the two seats fetch apart. */
function isHazard(def: CardDefinition | undefined): boolean {
  return String((def as unknown as { cardType?: string } | undefined)?.cardType ?? '')
    .startsWith('hazard-');
}

/**
 * The hand module. No context gate: a sideboard action is always its own.
 */
export const handModule: H2Module = {
  name: 'hand',
  ownedActionTypes: OWNED_ACTION_TYPES,

  /**
   * Whether the card a plan is built on survives to be played.
   *
   * `hand` owns this step because `hand` owns `discard-card`, and the
   * end-of-turn discard is where a commitment dies quietly: the module prices
   * a card by what it is worth *in hand* — its shadow price — and a card being
   * held for a site three turns away looks, to that price, exactly like a card
   * doing nothing. The plan is what says otherwise, and this is the channel it
   * says it through.
   *
   * Zero rather than a discount, because the card is gone. That is the veto
   * the spec asks for, expressed as a probability so the layer keeps one
   * mechanism instead of two.
   */
  planStepDelta(
    action: GameAction,
    plan: Plan,
    step: PlanStep,
  ): number | null {
    if (step.tag !== CARD_STEP) return null;
    if (action.type !== 'discard-card') return null;
    const discarded = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!discarded) return null;
    return discarded === plan.goal.cardInstanceId ? 0 : null;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const owned = new Set<string>(OWNED_ACTION_TYPES);
    if (!owned.has(action.type)) return null;
    const { standing, view, tunables } = context;

    if (action.type === 'discard-card' || action.type === 'draw-cards') {
      // A card leaving the hand costs what holding it was worth; a card drawn
      // gains it. Both use the same price, which is the point of §3.5 — one
      // number, one owner — even while that number is still the flat
      // placeholder rather than a real reservation value.
      const discarding = action.type === 'discard-card';
      // Priced only when discarding: a draw has nothing in particular to
      // value, and the creature valuation resolves whole attacks.
      const discarded = discarding
        ? computeCardPrices(view, context.cardPool, standing, tunables)
          .worth((action as unknown as { cardInstanceId: CardInstanceId }).cardInstanceId)
        : null;
      // What a discard costs is what *that card* was worth, not what a card is
      // worth on average. This is the whole point of the shadow price: the
      // module can now prefer throwing the faction it can never score over the
      // creature that would tap their company.
      const dtsd = discarding
        ? -(discarded?.tsd ?? tunables.provisionalCardPrice)
        : tunables.resourceDrawValue;
      const outcomes: Outcome[] = [{
        p: 1,
        label: discarding
          ? `discard ${discarded?.name ?? 'a card'} — ${discarded?.reason ?? 'the flat price'}`
          : 'draw to refill the hand',
        dtsd,
      }];
      return scoredEvaluation({
        action,
        module: 'hand',
        outcomes,
        standing,
        headline: discarding ? 'discard' : 'draw',
        detail: [
          node('hand economy', dtsd, [
            leaf(discarding ? `${discarded?.name ?? 'card'} given up` : 'card gained', Math.abs(dtsd), {
              unit: 'tsd',
              tunable: discarding ? 'potentialDiscount' : 'resourceDrawValue',
              note: discarding ? discarded?.reason : undefined,
            }),
            leaf('hand size', view.self.hand.length),
            leaf('deck remaining', view.self.playDeck.length),
          ]),
        ],
        assumptions: [
          discarding
            ? 'a card is priced by what it would be worth if it could be played, discounted by '
              + '`potentialDiscount`; whether it is *reachable* — the right site, the right '
              + 'company, the influence to spare — is not modelled'
            : 'a drawn card is priced at the average worth of a draw, not at what is actually drawn',
          ...ASSUMPTIONS,
        ],
      });
    }

    const access = SIDEBOARD_ACCESS[action.type];
    if (!access) return null;
    const prices = computeCardPrices(view, context.cardPool, standing, tunables);

    // What the sideboard could actually supply, best first. The two seats reach
    // different halves of it: the untap access fetches hazards, the avatar tap
    // fetches resources and characters.
    const reachable = view.self.sideboard
      .filter(card => isHazard(context.cardPool[card.definitionId]) === (access.seat === 'hazard'))
      .map(card => prices.quote(card.definitionId as string))
      .sort((a, b) => b.tsd - a.tsd);
    // Only the best card is priced, even where the variant may take five. The
    // second one's worth depends on the plan the first one changes — `hazards`
    // is supermodular and its slots are finite — and summing independent
    // marginals for five creatures credits the hazard player with five bundles
    // it has no limit to play. So the five-card variant is deliberately
    // *understated* rather than guessed at, and the assumption says so.
    const best = reachable[0];
    // A card that lands in the deck must still be drawn; one that lands in the
    // discard waits for the deck to run out first. The same discount an unplayed
    // card already carries, applied once per step of that distance.
    const reach = tunables.potentialDiscount ** access.steps;
    const gain = (best?.tsd ?? 0) * reach;

    const cost = access.seat === 'hazard'
      ? ((): { tsd: number; reason: string } => {
        const plan = computeHazardPlan(view, context.cardPool, standing, tunables);
        const lost = plan.totalHarm - plan.harmIfLimitsHalved();
        return {
          tsd: lost,
          reason: lost > 0
            ? `the coming hazard limit is halved: the plan denies ${plan.totalHarm.toFixed(1)} at `
              + `full limits and ${plan.harmIfLimitsHalved().toFixed(1)} at half`
            : 'the coming hazard limit is halved, but the hand holds nothing the lost slots '
              + 'would have carried',
        };
      })()
      : ((): { tsd: number; reason: string } => {
        const avatar = namedCharacter(action);
        if (!avatar) return { tsd: tunables.tapTempoCost, reason: 'flat tempo — the action names no avatar' };
        const price = computeCharacterValue(view, context.cardPool, standing, tunables).tapCost(avatar);
        return { tsd: price.tsd, reason: `taps the avatar — ${price.reason}` };
      })();

    const dtsd = gain - cost.tsd;
    const outcomes: Outcome[] = [{
      p: 1,
      label: `reach into the sideboard for up to ${access.cards} card(s) into the ${access.where}`,
      dtsd,
    }];
    const detail: Rationale[] = [
      leaf('what it fetches', gain, {
        unit: 'tsd',
        tunable: 'potentialDiscount',
        note: best
          ? `${best.name} — ${best.reason}, discounted ${access.steps}× for landing in `
            + `the ${access.where}`
          : 'the sideboard holds nothing this variant may take',
      }),
      leaf('what it costs', cost.tsd, { unit: 'tsd', note: cost.reason }),
      leaf('sideboard remaining', view.self.sideboard.length, {
        note: access.cards > 1
          ? `up to ${access.cards} may be taken; only the best is priced`
          : undefined,
      }),
    ];

    return scoredEvaluation({
      action,
      module: 'hand',
      outcomes,
      standing,
      headline: 'sideboard access',
      detail: [node('the fetch', dtsd, detail, { unit: 'tsd' })],
      assumptions: [...SIDEBOARD_ASSUMPTIONS, ...ASSUMPTIONS],
    });
  },
};
