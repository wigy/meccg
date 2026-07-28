/**
 * @module ai/h2/modules/endgame/endgame
 *
 * The `endgame` module — when to stop the game.
 *
 * Calling the Free Council ends play, and it is the one decision where the
 * tournament-scoring machinery built for everything else does all the work
 * directly rather than through a proxy. Every other module asks "what is a
 * point worth if I score it?"; this one asks "is the score I already have the
 * one I want counted?"
 *
 * The answer is not the raw differential. Under CoE §10.3 the score is settled
 * by doubling and the diversity cap, and both are properties of *both* players'
 * totals at the moment of the call. Two things follow that a differential
 * cannot express:
 *
 * - **Doubling denial.** While the opponent has zero points in a source, ours
 *   in that source count double. If they are one play away from breaking that,
 *   the call is worth more now than next turn — and `standing` already reports
 *   the marginal value per source that says so.
 * - **The cap cuts both ways.** A player whose lead sits in one source has it
 *   trimmed to half their total. Calling while ahead on paper can mean calling
 *   into a score that is about to be cut.
 *
 * So the module compares the standing as it is against the standing as it
 * would be if the game continued — and it has no model of "continued", which
 * is stated rather than papered over.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { MP_SOURCES } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['call-free-council'] as const;

/** Assumptions every endgame evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'calling is priced against the standing as it is now, with no model of what another turn would '
  + 'bring — so a call is judged on the score in hand rather than on the race to improve it',
  'the opponent\'s remaining plays are not modelled: a source they are one card away from opening '
  + 'looks the same here as one they cannot reach',
];

/**
 * The endgame module.
 *
 * Its utility is the honest one: calling settles the score at the current
 * standing, so the change in win probability is the difference between the
 * fitted `W` at that standing and — since the game ends — certainty about it.
 * That is exactly what the risk oracle already computes when handed an outcome
 * distribution with a single certain branch.
 */
export const endgameModule: H2Module = {
  name: 'endgame',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type !== 'call-free-council') return null;
    const { standing } = context;

    // Calling converts a probable win into a settled one, or a probable loss
    // into a settled one. The score does not move; what moves is the
    // uncertainty, and `W` at the current standing is exactly the odds being
    // locked in.
    const settled = standing.tsd > 0 ? 1 : standing.tsd < 0 ? 0 : 0.5;
    const dtsd = 0;
    const outcomes: Outcome[] = [{
      p: 1,
      label: standing.tsd > 0
        ? `end the game ahead by ${standing.tsd} — the score stops moving`
        : standing.tsd < 0
          ? `end the game behind by ${-standing.tsd} — the score stops moving`
          : 'end the game level — the score stops moving',
      dtsd,
    }];

    // The utility is the settled result against the fitted odds of getting
    // there, not the (zero) change in score.
    const utility = settled - standing.risk.standing.winProbability;

    // Which sources are currently being doubled, and would stop being if the
    // opponent opened them. This is the doubling-denial term §3.3 names as one
    // of the levers the endgame owns.
    const doubling: Rationale[] = [];
    for (const source of MP_SOURCES) {
      if (source === 'kill' || source === 'misc') continue;
      if (standing.opponentMp[source] <= 0 && standing.selfMp[source] > 0) {
        doubling.push(leaf(source, standing.selfMp[source] * 2, {
          unit: 'mp',
          note: 'doubled while the opponent has none — lost the moment they score one',
        }));
      }
    }

    const detail: Rationale[] = [
      leaf('standing', standing.tsd, { unit: 'tsd', note: `${standing.selfScore} vs ${standing.opponentScore}` }),
      leaf('odds of winning if play continues', standing.risk.standing.winProbability, { unit: 'winprob' }),
      leaf('result if called now', settled, { unit: 'winprob', note: 'the score stops moving' }),
    ];
    if (doubling.length > 0) {
      detail.push(node('sources doubling right now', doubling.length, doubling, { note: 'CoE 10.3' }));
    } else {
      detail.push(leaf('sources doubling right now', 0, {
        note: 'nothing is riding on denial — the call is purely about the score in hand',
      }));
    }

    return {
      action,
      module: 'endgame',
      outcomes,
      expectedTsd: 0,
      sigmaTsd: 0,
      utility,
      method: 'integrated',
      rationale: node('call the Free Council', utility, [
        node('endgame', standing.tsd, detail),
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
