/**
 * @module ai/h2/modules/kill/kill
 *
 * The `kill` module — is fighting income or cost?
 *
 * Plan §3.2 puts this in the acquisition layer rather than beside `combat`,
 * and the distinction is the point: `combat` answers a tactical question
 * ("how do I face this strike?") while `kill` answers a portfolio one ("are we
 * banking kill points this game at all?"). They are separate because the
 * answers come apart. A company strong enough to defeat a creature turns an
 * attack into income; a weak one turns the same attack into a gift, and the
 * hazard player should be encouraged to keep making it.
 *
 * What this module owns is the *pre-assignment* window, where the defender can
 * still refuse the attack — `cancel-attack`, `cancel-by-tap`, `halve-strikes`.
 * `combat` prices those as harm avoided. `kill` prices what cancelling gives
 * up: the kill marshalling points the attack was offering, worth whatever a
 * kill point is worth in this standing, which is 2 when the opponent has none
 * and 0 once the source is capped.
 *
 * It deliberately does *not* own the strike window. Once strikes are assigned
 * the question is tactical again and `combat` has the better model of it.
 */

import type { CombatState, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';
import { killMpOnOffer } from '../../services/attack-value.js';

/**
 * Action types this module scores.
 *
 * These overlap with `combat`, which also lists them. The registry resolves
 * ownership by module order and context gate, and `kill` gates on the *whole
 * attack still being refusable* — before any strike is assigned — which is
 * exactly the window where the portfolio question applies.
 */
const OWNED_ACTION_TYPES = ['cancel-attack', 'cancel-by-tap', 'halve-strikes'] as const;

/** Whether the attack is still unassigned, so refusing it is still on the table. */
function beforeAssignment(combat: CombatState | null): boolean {
  return combat !== null
    && combat.phase === 'assign-strikes'
    && combat.strikeAssignments.length === 0;
}

/** Assumptions every kill evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the chance of actually defeating the attack is `combat`\'s to estimate; this module prices only '
  + 'what the kill points would be worth if it were defeated, so the two must be read together',
  'a creature refused now may be replayed later — the card is not gone, and no credit is taken '
  + 'for denying it permanently',
];

/**
 * The kill module: what refusing an attack gives up.
 *
 * The sign is the whole content. Cancelling is normally good — `combat` prices
 * the harm avoided — but when the company is strong and the creature carries
 * points, the attack is income and cancelling throws it away. This module
 * supplies the term that can make a cancel come out negative, which §3.4 names
 * as the correction `hazards` will eventually need with its sign flipped.
 */
export const killModule: H2Module = {
  name: 'kill',
  ownedActionTypes: OWNED_ACTION_TYPES,

  claims(context: ModuleContext): boolean {
    const combat = context.view.combat;
    if (!beforeAssignment(combat)) return false;
    if (combat!.defendingPlayerId !== context.view.self.id) return false;
    // Only worth claiming when there are points on the table. With no kill MP
    // this is pure harm avoidance and `combat` owns it.
    return killMpOnOffer(context.cardPool, combat!, context.view) > 0;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const combat = context.view.combat;
    if (!combat) return null;
    const { standing, tunables } = context;
    const killMp = killMpOnOffer(context.cardPool, combat, context.view);
    if (killMp <= 0) return null;

    const killTsd = standing.tsdAfter({ kill: killMp }) - standing.tsd;
    // Refusing the attack forfeits the points it was offering, and costs the
    // card or tap that refused it. Both are certain; what is uncertain is
    // whether the company would have won the fight, and that is `combat`'s
    // question, not this one's.
    const price = action.type === 'cancel-by-tap' ? tunables.tapTempoCost : tunables.provisionalCardPrice;
    const forfeited = action.type === 'halve-strikes' ? killTsd / 2 : killTsd;
    const dtsd = netTsdDelta({ realized: -forfeited, tempo: price }, tunables);

    const outcomes: Outcome[] = [{
      p: 1,
      label: action.type === 'halve-strikes'
        ? `halve the attack — part of ${killMp} kill MP put out of reach`
        : `refuse the attack — ${killMp} kill MP given up`,
      dtsd,
    }];
    const detail: Rationale[] = [
      leaf('kill marshalling points on offer', killMp, { unit: 'mp' }),
      leaf('worth of one kill point here', standing.marginal.kill, {
        unit: 'tsd',
        note: standing.marginal.kill === 0
          ? 'zero — the kill source is capped, so the attack is not income at all'
          : 'CoE 10.3, after doubling and the diversity cap',
      }),
      leaf('given up by refusing', -forfeited, { unit: 'tsd' }),
      leaf('price of refusing', price, {
        unit: 'tsd',
        tunable: action.type === 'cancel-by-tap' ? 'tapTempoCost' : 'provisionalCardPrice',
      }),
    ];

    return scoredEvaluation({
      action,
      module: 'kill',
      outcomes,
      standing,
      headline: 'refuse the attack',
      detail: [node('kill points', killMp, detail)],
      assumptions: ASSUMPTIONS,
    });
  },
};
