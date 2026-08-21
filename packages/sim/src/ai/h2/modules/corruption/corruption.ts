/**
 * @module ai/h2/modules/corruption/corruption
 *
 * The `corruption` module — what a pending corruption check is worth.
 *
 * Plan §3.3 calls this pure probability, and it is: the engine publishes the
 * 2d6 target on the `corruption-check` action (`roll > CP`, already adjusted
 * for the character's own modifier and any situational bonus), and it
 * pre-computes `possessions` — the exact list of items and allies that leave
 * play if the check fails. So both halves of the distribution come from the
 * action itself, and nothing about the corruption rules is restated here.
 *
 * The valuation is where it earns its place. The MP at stake is not the
 * printed total on those cards: it is what those points are worth *in this
 * standing*, source by source, after doubling and the diversity cap. A greater
 * item lost from a source already at the cap costs nothing; the same item lost
 * from a doubled source costs twice its face value. `standing` supplies both.
 *
 * A failure removes the character, not merely its possessions
 * (`removeFailedCorruptionCharacter`): the two grades — discard on a roll
 * within 1 of the corruption points, out of play on a hard fail — differ only
 * in where the card lands, so both cost the same marshalling points, and both
 * promote its followers back to general influence, which `character-value`
 * already prices.
 *
 * A corruption check is usually the only action on offer, so the module rarely
 * changes a decision. It is worth having anyway: `explain` can then say what a
 * position is risking, and the outcome distribution is one the calibration
 * harness can check against the reducer.
 *
 * Shedding an attached corruption card is the same valuation run backwards —
 * the roll narrows the failing band instead of widening it — but it lives in
 * `grants`, with every other card-granted ability. `claims()` is per decision
 * rather than per action, so two modules sharing `activate-granted-action`
 * would fight over a decision offering one grant of each kind and leave the
 * loser's grant unscored. What this module contributes there is
 * `character-value.corruptionRelief`, which both sides of the question share.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpDelta, MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { pAtLeast } from '../../core/dice.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';
import { computeCharacterValue } from '../../services/character-value.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['corruption-check', 'support-corruption-check'] as const;


/** The marshalling points a set of possessions would take with them. */
function possessionLoss(
  context: ModuleContext,
  characterId: CardInstanceId,
  possessions: readonly CardInstanceId[],
): { delta: MpDelta; described: string[] } {
  const delta: Record<string, number> = {};
  const described: string[] = [];
  const character = context.view.self.characters[characterId];
  const attached = character
    ? [...character.items, ...character.allies, ...character.hazards]
    : [];
  for (const instanceId of possessions) {
    const card = attached.find(a => a.instanceId === instanceId);
    const def: CardDefinition | undefined = card ? context.cardPool[card.definitionId] : undefined;
    if (!def) continue;
    const fields = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const points = fields.marshallingPoints ?? 0;
    if (points === 0) continue;
    const source = (fields.marshallingCategory ?? 'misc') as MpSource;
    delta[source] = (delta[source] ?? 0) - points;
    described.push(`${fields.name ?? (instanceId as string)} (${points} ${source})`);
  }
  return { delta, described };
}

/** Assumptions every corruption evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'a failed check removes the character as well as the possessions the action lists '
  + '(`removeFailedCorruptionCharacter`, CoE 7.1) — the two failure grades differ only in whether '
  + 'the card lands in the discard pile or out of play, which does not change the points lost',
  'nothing is assumed about cards that could still be played to change the target — those are '
  + 'separate actions and are scored on their own',
];

/**
 * The corruption-check module. No context gate: a `corruption-check` is always
 * a corruption decision.
 */
/** What failing a check costs: the points that leave, and everything else. */
interface FailureCost {
  /** Net TSD of the failure, negative. */
  readonly dtsd: number;
  /** Marshalling points at stake, priced in their own sources. */
  readonly mpLoss: number;
  /** What `character-value` says the character was worth beyond its points. */
  readonly lossCost: { readonly tsd: number; readonly reason: string };
  /** The possessions that leave with it, for the rationale. */
  readonly described: readonly string[];
  /** The character's printed name, when it can be resolved. */
  readonly name: string;
}

/**
 * Price a failed corruption check once, for both the check and its support.
 *
 * Shared rather than computed twice because the support action is worth
 * exactly the failure it averts: two models of one number would eventually
 * disagree about how bad a corruption is, and nothing in the output would say
 * which was right.
 */
function failureCostOf(
  context: ModuleContext,
  characterId: CardInstanceId,
  possessions: readonly CardInstanceId[],
): FailureCost {
  const { standing, tunables, cardPool, view } = context;
  const character = view.self.characters[characterId];
  const charDef = character ? cardPool[character.definitionId] : undefined;
  const charFields = charDef as unknown as {
    name?: string; marshallingPoints?: number; marshallingCategory?: string;
  } | undefined;
  const { delta, described } = possessionLoss(context, characterId, possessions);
  const ownPoints = charFields?.marshallingPoints ?? 0;
  if (ownPoints > 0) {
    const source = (charFields?.marshallingCategory ?? 'character') as MpSource;
    delta[source] = (delta[source] ?? 0) - ownPoints;
  }
  const mpLoss = standing.tsdAfter(delta) - standing.tsd;
  const lossCost = computeCharacterValue(view, cardPool, standing, tunables).lossCost(characterId);
  return {
    dtsd: netTsdDelta({ realized: mpLoss, tempo: lossCost.tsd }, tunables),
    mpLoss,
    lossCost,
    described,
    name: charFields?.name ?? 'the character',
  };
}

/**
 * Score tapping a character to add +1 to somebody else's corruption check.
 *
 * The rules make this exactly computable and there is nothing to guess at: an
 * untapped character "may tap for +1 each before the roll"
 * (`actions-universal.ts`), so supporting moves the 2d6 target down by one and
 * the whole value is the failure it averts.
 *
 *   gain = [P(pass at need−1) − P(pass at need)] × what failing costs
 *   cost = what tapping that particular character forgoes
 *
 * Every term is already in the project: the engine publishes `need` on the
 * check itself, `failureCostOf` prices the failure for both actions, and
 * `character-value.tapCost` prices the tap by what that character was for
 * rather than by a flat rate.
 *
 * It is here because it was **unowned**. Measured against the recorded corpus,
 * `support-corruption-check` is what the agent does instead of passing 36
 * times in eight games, all of it in the Free Council — and with no module
 * claiming the action, every one of those decisions was made by the
 * Heuristics-1 weight soup this design exists to replace.
 */
function evaluateSupport(action: GameAction, context: ModuleContext): Evaluation | null {
  const fields = action as unknown as {
    supportingCharacterId?: CardInstanceId;
    targetCharacterId?: CardInstanceId;
  };
  if (!fields.supportingCharacterId) return null;

  // The check being supported is on the table beside it. Matched by the
  // character it names, or taken as the only one on offer — which is the Free
  // Council flow, where the action omits the target because the phase state
  // already holds it.
  const checks = context.legalActions.filter(a => a.type === 'corruption-check');
  const check = (fields.targetCharacterId
    ? checks.find(a => (a as unknown as { characterId?: CardInstanceId }).characterId
      === fields.targetCharacterId)
    : checks.length === 1 ? checks[0] : undefined) as unknown as {
      characterId?: CardInstanceId; need?: number; possessions?: readonly CardInstanceId[];
    } | undefined;
  // No check to read means no opinion: declining is what the module does with
  // a window it cannot price, rather than inventing one.
  if (!check || typeof check.need !== 'number' || !check.characterId) return null;
  if (check.need <= 2) return null;

  const { standing, tunables, cardPool, view } = context;
  const pWithout = pAtLeast(check.need);
  const pWith = pAtLeast(check.need - 1);
  const failure = failureCostOf(context, check.characterId, check.possessions ?? []);
  // The support is worth the mass it moves out of the failing band.
  const averted = (pWith - pWithout) * -failure.dtsd;
  const tap = computeCharacterValue(view, cardPool, standing, tunables)
    .tapCost(fields.supportingCharacterId);

  const dtsd = netTsdDelta({ realized: averted, tempo: tap.tsd }, tunables);
  const outcomes: Outcome[] = [{
    p: 1,
    label: `tap for +1 on ${failure.name}'s check — ${((pWith - pWithout) * 100).toFixed(1)}% `
      + 'less chance of losing them',
    dtsd,
  }];
  return scoredEvaluation({
    action,
    module: 'corruption',
    outcomes,
    standing,
    headline: 'support a corruption check',
    detail: [
      node('what the +1 buys', averted, [
        leaf('need on 2d6', check.need, { note: 'published by the engine on the check itself' }),
        leaf('P(the check holds)', pWithout, { unit: 'p' }),
        leaf('P(it holds with the +1)', pWith, { unit: 'p', note: 'CoE: an untapped character may tap for +1' }),
        leaf('what failing costs', -failure.dtsd, {
          unit: 'tsd',
          note: failure.described.length > 0
            ? `${failure.name} plus ${failure.described.join(', ')}`
            : `${failure.name} and ${failure.lossCost.reason}`,
        }),
      ], { unit: 'tsd' }),
      leaf('the tap it spends', tap.tsd, { unit: 'tsd', note: tap.reason }),
    ],
    assumptions: [
      ...ASSUMPTIONS,
      'only one supporter is priced at a time; several characters tapping for +1 each are scored '
      + 'as separate decisions, so the second is valued against a check the first already helped',
    ],
  });
}

export const corruptionModule: H2Module = {
  name: 'corruption',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'support-corruption-check') return evaluateSupport(action, context);
    if (action.type !== 'corruption-check') return null;
    const fields = action as unknown as {
      characterId?: CardInstanceId;
      corruptionPoints?: number;
      corruptionModifier?: number;
      possessions?: readonly CardInstanceId[];
      need?: number;
    };
    if (typeof fields.need !== 'number' || !fields.characterId) return null;

    const { standing, tunables } = context;
    const pSurvive = pAtLeast(fields.need);

    // What leaves play if it fails — shared with the support action, so the
    // two cannot disagree about how bad a corruption is.
    const failure = failureCostOf(context, fields.characterId, fields.possessions ?? []);
    const { mpLoss, lossCost, described } = failure;

    const outcomes: Outcome[] = [];
    if (pSurvive > 0) {
      outcomes.push({ p: pSurvive, label: 'the check holds — nothing is lost', dtsd: 0 });
    }
    if (pSurvive < 1) {
      outcomes.push({
        p: 1 - pSurvive,
        label: described.length > 0
          ? `corrupted — ${failure.name} and ${described.join(', ')} leave play`
          : `corrupted — ${failure.name} leaves play`,
        dtsd: failure.dtsd,
      });
    }

    // **The cost is sunk, and that is the whole correction.**
    //
    // Scored absolutely, a corruption check is a risk with no upside, so it
    // came out at or below zero every time — 43 of 43 offered in the recorded
    // corpus — and lost to `pass` at zero. But passing does not avoid the
    // check. A pending corruption check "gates all other organization actions
    // until it is resolved" (see `transferItemActions`): the roll is coming
    // whatever the agent does, and declining only freezes the phase around it.
    //
    // So the outcomes below describe reality and the wrong comparison was being
    // made with them. Shifting the distribution by its own expectation prices
    // the *decision* rather than the event: what resolving costs, relative to
    // the unavoidable baseline, is nothing. σ is untouched, because the risk is
    // real even when the choice about it is not.
    //
    // What is left is what resolving actually buys — the rest of the
    // organization phase, which is where every resource this player will ever
    // play has to be played. The human took the check in all 43 positions.
    const unavoidable = outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
    const decided: Outcome[] = outcomes.map(o => ({
      ...o,
      dtsd: o.dtsd - unavoidable + tunables.gatingResolutionTsd,
    }));

    const detail: Rationale[] = [
      leaf('the roll is coming either way', -unavoidable, {
        unit: 'tsd',
        note: 'a pending check gates every other organization action, so declining stalls the phase '
          + 'rather than avoiding the check',
      }),
      leaf('unblocking the phase', tunables.gatingResolutionTsd, {
        unit: 'tsd',
        tunable: 'gatingResolutionTsd',
      }),
      leaf('need on 2d6', fields.need, {
        note: `corruption points ${fields.corruptionPoints ?? '?'}, `
          + `modifier ${fields.corruptionModifier ?? 0} — published by the engine`,
      }),
      leaf('P(the check holds)', pSurvive, { unit: 'p' }),
      leaf('marshalling points at stake', mpLoss, {
        unit: 'tsd',
        note: described.length > 0
          ? `${failure.name} plus ${described.join(', ')}, each priced in its own source`
          : 'the character\'s own points',
      }),
      leaf('what else is lost', lossCost.tsd, { unit: 'tsd', note: lossCost.reason }),
    ];

    return scoredEvaluation({
      action,
      module: 'corruption',
      outcomes: decided,
      standing,
      headline: 'corruption check',
      detail: [node('check', fields.need, detail)],
      assumptions: ASSUMPTIONS,
    });
  },
};
