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

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext } from '../../core/types.js';
import { declaredEventEvaluation } from '../../services/event-value.js';

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
    // The reading, the price and the rationale all live in `event-value`, because
    // `stage` needs the same answer about a permanent event it does not recognise
    // as a stage resource, and a second copy would be a second opinion.
    return declaredEventEvaluation(action, context, 'events');
  },
};
