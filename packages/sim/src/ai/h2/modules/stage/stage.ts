/**
 * @module ai/h2/modules/stage/stage
 *
 * The `stage` module — Fallen-wizard stage resources in the organization phase.
 *
 * The policy this module encodes is deliberately blunt: **every playable stage
 * resource is played**. That is not a heuristic shortcut but a property of the
 * decks themselves — a Fallen-wizard deck is built so that all of its stage
 * cards reach the table, because the payoff cards are gated on the running
 * stage-point total (Await the Onset wh-96, Prophet of Doom wh-106 and The
 * White Hand wh-122 all demand 12 or more) and the stage-point drawbacks the
 * MEWH hazards tier on (Cruel Claw Perceived wh-16, Heart Grown Cold wh-21,
 * Alatar's detainment clause) are accepted at deck-construction time, not
 * managed at play time. The module still *prices* the play rather than
 * hard-coding a rank: realized marshalling points through the standing, plus
 * the card's stage points through `stagePointTsd` — a positive utility that
 * beats `pass` by valuation, so the policy can be outweighed the day a module
 * learns something this one cannot see, and `explain` shows the number either
 * way.
 *
 * Ownership is narrower than the action type. Stage resources are played via
 * the generic `play-permanent-event` action, which also carries every
 * non-stage permanent event in the game — Fellowship, Gates of Morning, cards
 * whose value lives in effects this module cannot read. Those are *declined*
 * per action (`evaluate` returns null), which leaves them exactly as uncovered
 * as they were before this module existed, rather than scored at an invented
 * number.
 *
 * The module also owns `discard-stage-resource`, the organization-phase action
 * that takes a stage card back off the table (MEWH, floor of 3 stage points).
 * Under the always-play policy a voluntary discard is the same valuation run
 * backwards — the marshalling points leave, the progression is surrendered —
 * so it prices negative and ranks below `pass`, which is the point: keeping it
 * covered is what stops a fallback from discarding on a unitless weight.
 *
 * No proposer: a stage resource needs no site and no journey, so the play is
 * offered the moment it is legal and there is nothing for the plan layer to
 * route. No context gate: what the module cannot price it declines per action.
 */

import { stagePointsOfCard } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-permanent-event', 'discard-stage-resource'] as const;

/** What a stage card contributes: its identity, points, and stage points. */
interface StageCard {
  readonly name: string;
  readonly source: MpSource;
  readonly marshallingPoints: number;
  readonly stagePoints: number;
}

/**
 * The stage card an action names, resolved from the zone the action reads it
 * from — hand for a play, the table for a discard — or null when the card is
 * not a stage resource at all.
 *
 * The alignment check is the module's whole ownership rule: `alignment:
 * "stage"` (MEWH §1) is what the engine itself keys stage behaviour on
 * (`organization-events.ts`, `discardStageResourceActions`), reused here
 * rather than guessed from card type or set.
 */
function stageCardOf(
  context: ModuleContext,
  instanceId: CardInstanceId,
  zone: 'hand' | 'in-play',
): StageCard | null {
  const cards = zone === 'hand' ? context.view.self.hand : context.view.self.cardsInPlay;
  const card = cards.find(c => c.instanceId === instanceId);
  const def: CardDefinition | undefined = card ? context.cardPool[card.definitionId] : undefined;
  if (!def) return null;
  const fields = def as unknown as {
    name?: string;
    alignment?: string;
    marshallingPoints?: number;
    marshallingCategory?: string;
  };
  if (fields.alignment !== 'stage') return null;
  return {
    name: fields.name ?? (instanceId as string),
    source: (fields.marshallingCategory ?? 'misc') as MpSource,
    marshallingPoints: fields.marshallingPoints ?? 0,
    // The engine's own tally (`reducer-utils.ts`), not a re-reading of the
    // effect list. Conditional stage points whose `when` clause needs a
    // context this module does not build are dropped by the empty default,
    // which under-counts rather than invents.
    stagePoints: stagePointsOfCard(def),
  };
}

/** Assumptions every stage evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the deck is built so every stage card reaches the table: the stage-point thresholds that '
  + 'strengthen opponent hazards (Cruel Claw Perceived, Heart Grown Cold, the avatar\'s detainment '
  + 'clause) are treated as accepted at deck construction, and crossing one is not charged here',
  'a stage point is priced as flat progression toward the deck\'s gated payoffs; its real worth '
  + 'rises as a gate like "12 or more stage points" comes into reach, which a flat figure '
  + 'understates late and overstates once every gate is open',
  'conditional stage points (a when-clause on the stage-points effect) are counted only when they '
  + 'hold in an empty context, so a card granting extra points in a state this module cannot see '
  + 'is under-valued, never over-valued',
];

/**
 * The stage module. What it recognises — a permanent event carrying
 * `alignment: "stage"` — it prices; every other permanent event is declined
 * per action, leaving the decision exactly as covered as it was before.
 */
export const stageModule: H2Module = {
  name: 'stage',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const { standing, tunables } = context;

    if (action.type === 'play-permanent-event') {
      const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
      if (!instanceId) return null;
      const card = stageCardOf(context, instanceId, 'hand');
      // Not a stage resource: someone else's permanent event, honestly
      // declined rather than scored — see the module docstring.
      if (!card) return null;

      // What the printed points are worth *here* — 2, 1, or 0 at the CoE 10.3
      // half-total cap — from the tournament scorer, not a constant per MP.
      const gain = card.marshallingPoints > 0
        ? standing.tsdAfter({ [card.source]: card.marshallingPoints }) - standing.tsd
        : 0;
      // Progression: plays the stage-point total unlocks later. Positive even
      // when the marshalling points cap to zero, which is what implements
      // "every playable stage resource is played" as a valuation instead of a
      // rule.
      const progression = card.stagePoints * tunables.stagePointTsd;
      // No tempo term: a stage resource is played free during organization —
      // no site, no tap, no roll — and the card leaving hand is the deck's
      // design, not a price this module should charge against it.
      const dtsd = netTsdDelta({ realized: gain, potential: progression }, tunables);

      const outcomes: Outcome[] = [{
        p: 1,
        label: `play ${card.name} — ${card.stagePoints} stage point(s)`
          + (card.marshallingPoints > 0 ? `, ${card.marshallingPoints} ${card.source} MP` : ''),
        dtsd,
      }];
      const detail: Rationale[] = [
        leaf('card', card.name),
        leaf('stage points', card.stagePoints, { note: 'MEWH §1, the engine\'s own tally' }),
        leaf('worth of one stage point', tunables.stagePointTsd, {
          unit: 'tsd',
          tunable: 'stagePointTsd',
          note: `progression toward the deck's gated payoffs, discounted at potentialDiscount `
            + `(${tunables.potentialDiscount})`,
        }),
        leaf('marshalling points', card.marshallingPoints, { unit: 'mp', note: `${card.source} source` }),
        leaf(`worth of one ${card.source} point here`, standing.marginal[card.source], {
          unit: 'tsd',
          note: standing.marginal[card.source] === 0
            ? 'zero — that source is at the half-total cap (CoE 10.3); the stage points still pay'
            : 'CoE 10.3, after doubling and the diversity cap',
        }),
        leaf('gain', gain, { unit: 'tsd' }),
      ];

      return scoredEvaluation({
        action,
        module: 'stage',
        outcomes,
        standing,
        headline: `play stage resource ${card.name}`,
        detail: [node('the stage card', dtsd, detail, { unit: 'tsd' })],
        assumptions: ASSUMPTIONS,
      });
    }

    if (action.type === 'discard-stage-resource') {
      const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
      if (!instanceId) return null;
      const card = stageCardOf(context, instanceId, 'in-play');
      if (!card) return null;

      // The play, run backwards: the points leave the table and the
      // progression is surrendered. Negative by construction, which ranks it
      // below `pass` — the always-play policy's other half.
      const loss = card.marshallingPoints > 0
        ? standing.tsdAfter({ [card.source]: -card.marshallingPoints }) - standing.tsd
        : 0;
      const progression = -card.stagePoints * tunables.stagePointTsd;
      const dtsd = netTsdDelta({ realized: loss, potential: progression }, tunables);

      const outcomes: Outcome[] = [{
        p: 1,
        label: `discard ${card.name} — ${card.stagePoints} stage point(s) surrendered`,
        dtsd,
      }];
      return scoredEvaluation({
        action,
        module: 'stage',
        outcomes,
        standing,
        headline: `discard stage resource ${card.name}`,
        detail: [
          node('the surrender', dtsd, [
            leaf('card', card.name),
            leaf('stage points given up', card.stagePoints, { note: 'MEWH §1' }),
            leaf('worth of one stage point', tunables.stagePointTsd, {
              unit: 'tsd', tunable: 'stagePointTsd',
            }),
            leaf('marshalling points given up', card.marshallingPoints, {
              unit: 'mp', note: `${card.source} source`,
            }),
            leaf('loss', loss, { unit: 'tsd' }),
          ], { unit: 'tsd' }),
        ],
        assumptions: ASSUMPTIONS,
      });
    }

    return null;
  },
};
