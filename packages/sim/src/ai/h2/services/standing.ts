/**
 * @module ai/h2/services/standing
 *
 * The `standing` service — the single place the tournament scorer is probed.
 *
 * It answers the question every acquisition module has to ask before it spends
 * a turn chasing a marshalling-point source: *what is one more point in this
 * source actually worth right now?* Under CoE §10.3 the honest answer is 2
 * (the opponent has none in that source, so ours double), 1, or **0** (the
 * source already sits at the half-total diversity cap) — and no H1 evaluator
 * can represent the last case at all, which is why H1 will happily spend a
 * turn and a risky influence check on a faction worth nothing.
 *
 * The service also owns the conversion from the standing to the risk posture,
 * so every module shares one answer instead of forming private opinions.
 *
 * The {@link Standing} *interface* lives in `core/types` and only its
 * construction lives here. That is the layering the architecture test enforces:
 * `core` is the vocabulary every module speaks, and a vocabulary that imports
 * from a service depends on one of the things that speaks it.
 */

import type { PlayerView } from '@meccg/shared';
import { computeTournamentBreakdown, computeTournamentScore } from '@meccg/shared';
import type { Outcome, Rationale, Standing } from '../core/types.js';
import type { Tunables } from '../core/tunables.js';
import type { WinProbModel } from '../core/winprob.js';
import type { MpDelta, MpSource } from '../core/tsd.js';
import { MP_SOURCES, marginalMpValue, tsd, tsdAfter } from '../core/tsd.js';
import type { ScoredOutcomes } from '../core/risk.js';
import { riskPosture, scoreOutcomes } from '../core/risk.js';
import { leaf, node } from '../core/rationale.js';

/**
 * Build the standing from a player view.
 *
 * @param riskOverride - Forces `lambda` instead of deriving it, for
 *   `explain --risk` and `sweep --over risk`.
 */
export function computeStanding(
  view: PlayerView,
  model: WinProbModel,
  tunables: Tunables,
  riskOverride?: number,
): Standing {
  const selfMp = view.self.marshallingPoints;
  const opponentMp = view.opponent.marshallingPoints;
  const differential = tsd(selfMp, opponentMp);
  const marginal = {} as Record<MpSource, number>;
  for (const source of MP_SOURCES) marginal[source] = marginalMpValue(selfMp, opponentMp, source);

  const selfBreakdown = computeTournamentBreakdown(selfMp, opponentMp);
  const opponentBreakdown = computeTournamentBreakdown(opponentMp, selfMp);
  const selfScore = computeTournamentScore(selfMp, opponentMp);
  const opponentScore = computeTournamentScore(opponentMp, selfMp);
  const risk = riskPosture(model, tunables, differential, view.turnNumber, riskOverride);

  return {
    selfMp,
    opponentMp,
    selfBreakdown,
    opponentBreakdown,
    selfScore,
    opponentScore,
    tsd: differential,
    marginal,
    turnNumber: view.turnNumber,
    risk,
    model,

    tsdAfter(selfDelta: MpDelta, opponentDelta: MpDelta = {}): number {
      return tsdAfter(selfMp, opponentMp, selfDelta, opponentDelta);
    },

    score(outcomes: readonly Outcome[]): ScoredOutcomes {
      return scoreOutcomes(model, risk, outcomes);
    },

    rationale(): Rationale {
      const sources = MP_SOURCES.map(source => leaf(
        source,
        marginal[source],
        {
          unit: 'tsd',
          note: `raw ${selfMp[source]} vs ${opponentMp[source]}, adjusted ${selfBreakdown[source]}`,
        },
      ));
      const children = [
        leaf('tournament score', `${selfScore} vs ${opponentScore}`),
        leaf('turn', view.turnNumber, { unit: 'turns' }),
        leaf('W(now)', risk.standing.winProbability, { unit: 'winprob' }),
        leaf('risk λ', risk.lambda, { note: risk.source, tunable: 'riskCurvatureScale' }),
      ];
      if (risk.source === 'override') {
        children.push(leaf('utilities evaluated at', risk.standing.effectiveTsd, {
          unit: 'tsd',
          note: `the standing whose curvature matches λ ${risk.lambda.toFixed(2)}`,
        }));
      }
      children.push(node('marginal value of +1 MP by source', '', sources, { note: 'CoE 10.3' }));
      return node('standing', differential, children, { unit: 'tsd' });
    },
  };
}

export type { Standing } from '../core/types.js';
