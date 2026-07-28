/**
 * @module ai/h2/modules/characters/characters
 *
 * The `characters` module — bringing a character into play, and changing who
 * holds it.
 *
 * A character is the only resource in the game that is simultaneously a score,
 * a cost and a capability. Its marshalling points count toward the character
 * source; its mind is charged against a 20-point general-influence pool; and
 * once in play it supplies the prowess that survives combats and the direct
 * influence that reaches factions. This module prices the first two, which are
 * exact, and reports the third rather than guessing at it.
 *
 * The mind cost is the part H1 treats as a gate — play the character if it
 * fits — and the part that is really a price. A mind-6 character consumes
 * nearly a third of the pool, and what that displaces is whatever else would
 * have been played into it. `budget` supplies what is free; what the
 * displacement is worth belongs to the roster plan of §3.2, which does not
 * exist, so it is declared rather than invented.
 *
 * `move-to-influence` transfers a character between a controller's direct
 * influence and the general pool. It moves no marshalling points, but it does
 * move direct influence — and free direct influence is exactly what an
 * influence attempt spends (`reducer-site.ts`). So the action is scored as
 * point-neutral with the influence change reported, which is the honest shape
 * until the strategic half can say what that influence is for.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-character', 'move-to-influence'] as const;

/** A character definition named by an action, from hand or from play. */
function characterOf(
  context: ModuleContext,
  instanceId: CardInstanceId | undefined,
): { name: string; source: MpSource; marshallingPoints: number; mind: number } | null {
  if (!instanceId) return null;
  const inHand = context.view.self.hand.find(c => c.instanceId === instanceId);
  const inPlay = context.view.self.characters[instanceId];
  const definitionId = inHand?.definitionId ?? inPlay?.definitionId;
  const def: CardDefinition | undefined = definitionId ? context.cardPool[definitionId] : undefined;
  if (!def) return null;
  const fields = def as unknown as {
    name?: string; marshallingPoints?: number; marshallingCategory?: string; mind?: number;
  };
  return {
    name: fields.name ?? (instanceId as string),
    source: (fields.marshallingCategory ?? 'character') as MpSource,
    marshallingPoints: fields.marshallingPoints ?? 0,
    mind: fields.mind ?? 0,
  };
}

/** Assumptions every characters evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the general influence a character consumes is reported but not priced — what it displaces is '
  + 'the roster plan\'s to say (§3.2), and that strategic half does not exist yet',
  'the prowess and direct influence a character brings are not counted as value here; `combat` '
  + 'and `factions` price those where they are actually used',
  'a change of controller is scored as marshalling-point neutral, which it is',
];

/** The characters module. No context gate: both actions are always its own. */
export const charactersModule: H2Module = {
  name: 'characters',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const record = action as unknown as { characterId?: CardInstanceId; cardInstanceId?: CardInstanceId };
    const character = characterOf(context, record.cardInstanceId ?? record.characterId);
    if (!character) return null;
    const { standing, tunables } = context;
    const budget = computeBudget(context.view, context.cardPool);

    if (action.type === 'move-to-influence') {
      const held = budget.characters[(record.characterId ?? record.cardInstanceId) as string];
      const outcomes: Outcome[] = [{
        p: 1,
        label: `${character.name} changes controller — no marshalling points move`,
        dtsd: 0,
      }];
      const scored = standing.score(outcomes);
      return {
        action,
        module: 'characters',
        outcomes,
        expectedTsd: scored.expectedTsd,
        sigmaTsd: scored.sigmaTsd,
        utility: scored.utility,
        method: scored.method,
        rationale: node(`move ${character.name}`, scored.utility, [
          node('control', 0, [
            leaf('marshalling points moved', 0, { unit: 'mp', note: 'control changes, score does not' }),
            leaf('mind', character.mind, {
              note: 'charged against the general influence pool while held there',
            }),
            leaf('free direct influence it frees or consumes', held?.freeDirectInfluence ?? 0, {
              note: 'only an untapped character with free direct influence may attempt a faction '
                + '(reducer-site.ts) — reported, not priced',
            }),
          ]),
          scored.rationale,
        ], { unit: 'winprob' }),
        assumptions: ASSUMPTIONS,
      };
    }

    // Playing a character: its points are worth what that source is worth.
    const gain = character.marshallingPoints > 0
      ? standing.tsdAfter({ [character.source]: character.marshallingPoints }) - standing.tsd
      : 0;
    const dtsd = netTsdDelta({ realized: gain }, tunables);
    const outcomes: Outcome[] = [{
      p: 1,
      label: `play ${character.name} — ${character.marshallingPoints} ${character.source} MP, mind ${character.mind}`,
      dtsd,
    }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('character', character.name),
      leaf('marshalling points', character.marshallingPoints, { unit: 'mp', note: `${character.source} source` }),
      leaf(`worth of one ${character.source} point here`, standing.marginal[character.source], {
        unit: 'tsd',
        note: standing.marginal[character.source] === 0
          ? 'zero — that source is already at the half-total cap (CoE 10.3)'
          : 'CoE 10.3, after doubling and the diversity cap',
      }),
      leaf('mind', character.mind, {
        note: `${budget.freeGeneralInfluence} of ${budget.generalInfluence} general influence free — `
          + 'the cost is reported, not priced',
      }),
    ];

    return {
      action,
      module: 'characters',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${character.name}`, scored.utility, [
        node('character', character.marshallingPoints, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
