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
 * **Shedding a corruption card** belongs here too. Several attached hazards —
 * Lure of Expedience, Lure of Nature — grant the bearer an action to try to
 * remove them, and `activate-granted-action` carries the 2d6 threshold the way
 * every other rolled decision in this engine does. It is the same valuation as
 * a check, run backwards: the roll narrows the failing band instead of widening
 * it, and what that is worth is what failing would have cost. Measured over
 * three self-play games, half of all granted actions offered are this one.
 *
 * The other half are card-specific — fetching a spell, an extra region of
 * movement — and are declined, because pricing them means modelling what the
 * card does.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpDelta, MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { pAtLeast } from '../../core/dice.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { nameOf } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['corruption-check', 'activate-granted-action'] as const;


/** The grant that means "try to shake this card off". */
const REMOVE_SELF = 'remove-self-on-roll';

/**
 * The corruption a card puts on whoever it is attached to.
 *
 * Read from the card's declared effects, not from a top-level field: an
 * attached hazard states its corruption as a standing `stat-modifier` on
 * `corruption-points` — Lure of Nature is `value: 2` — while resource cards
 * that merely carry corruption print it as a number. Looking only at the number
 * found nothing on every hazard in the game, which is the whole family this
 * path exists for.
 *
 * Only *top-level* modifiers count. A `stat-modifier` nested inside an
 * `on-event` is something the card does when that event fires, not corruption
 * the bearer is carrying now.
 */
function attachedCorruption(def: CardDefinition | undefined): number {
  const fields = def as unknown as {
    corruptionPoints?: number;
    effects?: readonly { type?: string; stat?: string; value?: number }[];
  } | undefined;
  if (!fields) return 0;
  const fromEffects = (fields.effects ?? [])
    .filter(effect => effect.type === 'stat-modifier' && effect.stat === 'corruption-points')
    .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
  return fromEffects > 0 ? fromEffects : (fields.corruptionPoints ?? 0);
}

/**
 * Score attempting to remove an attached hazard from its bearer.
 *
 * Priced from the two things the engine and the card already publish: the 2d6
 * threshold on the action, and the corruption points printed on the card that
 * is attached. A card carrying no corruption is declined — what removing it is
 * worth is then a question about its text, which is the DSL's to answer.
 */
function evaluateRemoveAttached(context: ModuleContext, action: GameAction): Evaluation | null {
  const record = action as unknown as {
    actionId?: string;
    characterId?: CardInstanceId;
    sourceCardId?: CardInstanceId;
    sourceCardDefinitionId?: string;
    rollThreshold?: number;
  };
  if (record.actionId !== REMOVE_SELF) return null;
  const { characterId, sourceCardDefinitionId } = record;
  if (!characterId || !sourceCardDefinitionId) return null;
  const character = context.view.self.characters[characterId];
  if (!character) return null;

  const def = context.cardPool[sourceCardDefinitionId];
  const points = attachedCorruption(def);
  const name = (def as unknown as { name?: string } | undefined)?.name ?? sourceCardDefinitionId;
  // Nothing here can say what removing a restriction is worth — only what
  // removing corruption is worth. Declining leaves the decision honestly
  // uncovered rather than scored at an invented number.
  if (points <= 0) return null;

  const { standing, tunables } = context;
  const characterValue = computeCharacterValue(context.view, context.cardPool, standing, tunables);
  const relief = characterValue.corruptionRelief(characterId, points);
  const tap = characterValue.tapCost(characterId);
  const threshold = record.rollThreshold ?? 0;
  const success = pAtLeast(threshold);

  const outcomes: Outcome[] = [
    {
      p: success,
      label: `${name} comes off — ${points} corruption gone`,
      dtsd: netTsdDelta({ realized: relief.tsd, tempo: tap.tsd }, tunables),
    },
    {
      p: 1 - success,
      label: `the roll fails — ${name} stays, and the tap is spent anyway`,
      dtsd: netTsdDelta({ realized: 0, tempo: tap.tsd }, tunables),
    },
  ].filter(outcome => outcome.p > 0);
  const scored = standing.score(outcomes);

  return {
    action,
    module: 'corruption',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`try to shed ${name}`, scored.utility, [
      node('shedding a corruption card', relief.tsd, [
        leaf('bearer', nameOf(context.cardPool, character.definitionId as string, characterId)),
        leaf('needs on 2d6', threshold, { note: `${(success * 100).toFixed(1)}% to succeed` }),
        leaf('corruption removed', points, { unit: 'mp' }),
        leaf('worth of removing it', relief.tsd, { unit: 'tsd', note: relief.reason }),
        leaf('cost of the tap', tap.tsd, { unit: 'tsd', note: tap.reason }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'the attempt is assumed to cost a tap; a grant whose cost is something else is over-charged '
      + 'by one tap',
      'only the corruption the card carries is priced — a card that also restricts the company is '
      + 'worth more to remove than this says',
      'the relief is priced against one future check, the same simplification `resources` makes '
      + 'when it charges for carrying corruption in the first place',
    ],
  };
}

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
export const corruptionModule: H2Module = {
  name: 'corruption',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'activate-granted-action') return evaluateRemoveAttached(context, action);
    if (action.type !== 'corruption-check') return null;
    const fields = action as unknown as {
      characterId?: CardInstanceId;
      corruptionPoints?: number;
      corruptionModifier?: number;
      possessions?: readonly CardInstanceId[];
      need?: number;
    };
    if (typeof fields.need !== 'number' || !fields.characterId) return null;

    const { standing, tunables, cardPool, view } = context;
    const pSurvive = pAtLeast(fields.need);

    // What leaves play if it fails: the character's own points, everything the
    // action says it is carrying, and the influence it was holding.
    const character = view.self.characters[fields.characterId];
    const charDef = character ? cardPool[character.definitionId] : undefined;
    const charFields = charDef as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string } | undefined;
    const { delta, described } = possessionLoss(context, fields.characterId, fields.possessions ?? []);
    const ownPoints = charFields?.marshallingPoints ?? 0;
    if (ownPoints > 0) {
      const source = (charFields?.marshallingCategory ?? 'character') as MpSource;
      delta[source] = (delta[source] ?? 0) - ownPoints;
    }

    const mpLoss = standing.tsdAfter(delta) - standing.tsd;
    const characterValue = computeCharacterValue(view, cardPool, standing, tunables);
    const lossCost = characterValue.lossCost(fields.characterId);

    const outcomes: Outcome[] = [];
    if (pSurvive > 0) {
      outcomes.push({ p: pSurvive, label: 'the check holds — nothing is lost', dtsd: 0 });
    }
    if (pSurvive < 1) {
      outcomes.push({
        p: 1 - pSurvive,
        label: described.length > 0
          ? `corrupted — ${charFields?.name ?? 'the character'} and ${described.join(', ')} leave play`
          : `corrupted — ${charFields?.name ?? 'the character'} leaves play`,
        dtsd: netTsdDelta({ realized: mpLoss, tempo: lossCost.tsd }, tunables),
      });
    }

    const scored = standing.score(outcomes);
    const detail: Rationale[] = [
      leaf('need on 2d6', fields.need, {
        note: `corruption points ${fields.corruptionPoints ?? '?'}, `
          + `modifier ${fields.corruptionModifier ?? 0} — published by the engine`,
      }),
      leaf('P(the check holds)', pSurvive, { unit: 'p' }),
      leaf('marshalling points at stake', mpLoss, {
        unit: 'tsd',
        note: described.length > 0
          ? `${charFields?.name ?? 'character'} plus ${described.join(', ')}, each priced in its own source`
          : 'the character\'s own points',
      }),
      leaf('what else is lost', lossCost.tsd, { unit: 'tsd', note: lossCost.reason }),
    ];

    return {
      action,
      module: 'corruption',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node('corruption check', scored.utility, [
        node('check', fields.need, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
