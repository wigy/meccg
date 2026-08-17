/**
 * @module ai/h2/modules/events/events
 *
 * The `events` module — short and long events, priced by what their effects
 * declare.
 *
 * `play-short-event` is the largest unowned action type left, at 183 blocked
 * decisions in three self-play games, and it is the hardest kind of card to
 * price: an event does one specific thing, once, and the thing is the card's
 * text. That is the DSL's territory, not a module's.
 *
 * But the same seam that made `grants` possible is here too. The DSL declares
 * what an event does, and a few *families* of declared effect are worth
 * something this design already knows how to compute:
 *
 * - **A card comes back.** `move ... to: "hand"` or `to: "deck"` recovers a
 *   card, worth at least what a draw is worth — a floor, because the card is
 *   chosen rather than drawn.
 * - **Cards are drawn.** `draw-cards` (Dark Tryst) hands over a stated number of
 *   them; `draw-modifier` (A Short Rest) adds them to every company that moves
 *   this turn, which `draw-value` counts against the movement already planned.
 * - **A company is shut to creatures.** Stealth adds
 *   `no-creature-hazards-on-company` for the turn, and that is worth the whole
 *   hazard plan the opponent would otherwise aim at it — `defence`, against the
 *   creatures this opponent has actually shown. It is the most-offered short
 *   event in the game by a wide margin, 150 of 276 appearances in three games.
 *
 * Everything else is declined per action. That is the honest outcome and it is
 * most of them: an event whose value is "the opponent may not do X this turn"
 * cannot be priced without modelling X.
 *
 * The cost is the card itself, at its shadow price — which for an event whose
 * effect this module cannot read is the flat floor.
 *
 * ## Doing nothing is not the same as being unreadable
 *
 * An event is never scored negative for a family the module cannot *read*:
 * charging for the card and crediting nothing would make H2 refuse every event
 * in the game. But there are two cases where the module can **prove** the play
 * achieves nothing, and those are opinions rather than guesses:
 *
 * - **The card declares no effect this engine will execute.** Twilight's whole
 *   effect list is two `play-flag`s — declarations about *how* it may be played,
 *   not about what happens when it resolves. Its printed text cancels an
 *   environment card; the DSL does not say so, and the engine plays what the DSL
 *   declares. Playing it therefore spends a card for nothing. It was the second
 *   most-offered declined short event, 44 of 122 in three games. The rule is
 *   self-correcting: the day the cancel is written into the DSL, the effect list
 *   stops being declaration-only and the module goes back to declining.
 * - **A removal with nothing to remove.** Every short event in the pool that
 *   discards something from play — Marvels Told, Ancient Secrets, Voices of
 *   Malice, The Cock Crows, Wizard's River-horses — targets a *hazard event in
 *   play*, and with none in play the card resolves for nothing. When there is
 *   one, the module still declines, because what that event was doing is the
 *   thing it cannot price.
 *
 * That second case replaces a branch that was simply wrong. It read the same
 * `move ... from: "in-play" to: "discard"` and priced it as the corruption
 * relief of taking an attached hazard off one of our own characters — a
 * different effect, on a different target, that no card in this family has. The
 * module credited a benefit the card could not deliver whenever any of our
 * characters happened to be carrying a corrupting hazard.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { declaresAnEffect, gainOf } from '../../services/event-value.js';
import type { Effect } from '../../services/event-value.js';

/**
 * Action types this module scores.
 *
 * `play-long-event` was owned by **nothing** — not a module, and not the
 * Heuristics-1 evaluator that covers the phase, whose switch falls through to
 * `null` for it. So the ranking on a long-event decision held one candidate,
 * the baseline's `pass` at zero, and both agents passed the long-event phase
 * unconditionally in every game either has ever played. A whole card family —
 * A Short Rest among them, the one card in the pool that multiplies a turn's
 * draws — was unplayable by construction rather than by judgement.
 *
 * A long event is priced by the same machinery as a short one because it is the
 * same question: what does the effect list achieve, against what the card is
 * worth to spend. What differs is *when* the effect pays, and for the families
 * read here that difference is already in the numbers — a `draw-modifier` is
 * measured against the movement this turn's plan has declared, which is exactly
 * the window a long event lasts.
 */
const OWNED_ACTION_TYPES = ['play-short-event', 'play-long-event'] as const;



/**
 * The events module. No context gate: an event is always its own, and what it
 * cannot price it declines per action rather than per decision.
 */
export const eventsModule: H2Module = {
  name: 'events',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (!OWNED_ACTION_TYPES.includes(action.type as typeof OWNED_ACTION_TYPES[number])) return null;
    const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!instanceId) return null;
    const card = context.view.self.hand.find(c => c.instanceId === instanceId);
    if (!card) return null;

    const def = context.cardPool[card.definitionId];
    const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
    // A card whose whole effect list declares how it may be played, and nothing
    // that happens when it resolves, does nothing when it resolves. That is a
    // reading of the DSL rather than a judgement about the card, and it is the
    // one case where charging for the card is an opinion rather than a guess.
    const gain = declaresAnEffect(effects)
      ? gainOf(effects, context, action)
      : {
        tsd: 0,
        reason: 'the card declares no effect this engine will execute — only how it may be played',
      };
    // A family this module cannot read is declined, not charged. Charging for
    // the card and crediting nothing would make H2 refuse every event in the
    // game, which is worse than having no opinion about them.
    if (!gain) return null;

    const { standing, tunables } = context;
    // The card is charged at the *spending* price, not at what it is worth to
    // hold. Those became the same number when `card-price` learned to value
    // events, and for a single-use event they must not be: the reservation
    // value of keeping this card is the value of playing it, so charging it
    // against its own gain cancels — the whole reason moving `hazards` onto
    // the held price achieved nothing measurable. A shadow price is an
    // opportunity cost only when it prices the *next-best* use.
    const spent = tunables.provisionalCardPrice;
    const name = (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string);

    const dtsd = netTsdDelta({ realized: gain.tsd, tempo: spent }, tunables);
    const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${gain.reason}`, dtsd }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('event', name),
      leaf('what it does', gain.tsd, { unit: 'tsd', note: gain.reason }),
      leaf('the card it spends', spent, {
        unit: 'tsd',
        tunable: 'provisionalCardPrice',
        note: 'the spending price — what it is worth to hold is a different question',
      }),
    ];

    return {
      action,
      module: 'events',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${name}`, scored.utility, [
        node('the event', gain.tsd - spent, detail, { unit: 'tsd' }),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: [
        'an event is priced by the *family* of effect it declares, not by its text: a card that '
        + 'also restricts, cancels or enables something is under-valued here',
        'the play is assumed to cost only the card; a tap or discard the event also demands is not '
        + 'charged',
        'a card whose declared effects only say how it may be played is scored as doing nothing — '
        + 'true of this engine, and wrong about the printed card whenever the DSL is behind the text',
        'whether a removal has a target is decided by the filter keys this module reads (card type, '
        + 'event type, keywords); a filter it cannot read is assumed to have one, so the card is '
        + 'declined rather than called useless',
        'a long event is credited only for what it achieves *this* turn; one whose effect would pay '
        + 'again on a later turn is under-valued, and one played before the movement plan is '
        + 'declared is priced against a plan that may still change',
        'a card that swaps the whole hand for a fresh one (Favor of the Valar, `new-hand`) is '
        + 'declined rather than priced: it draws no *net* cards, and what the swap is worth is the '
        + 'difference between this hand and an average one — which is `card-price`\'s question, and '
        + 'asking it from here would be a cycle',
      ],
    };
  },
};
