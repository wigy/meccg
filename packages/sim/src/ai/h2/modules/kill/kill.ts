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
 *
 * It does own the end of a won fight: the `trophy-offer` window, where an Orc
 * or Troll who faced a strike may keep the creature as a trophy (CoE 3.IV).
 * That is still the kill question — the points are banked either way (3.IV.2)
 * — and what the trophy adds on top is the direct influence and prowess its
 * printed points buy the bearer (3.IV.3).
 */

import type { CardInstanceId, CombatState, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';
import { killMpOnOffer } from '../../services/attack-value.js';
import { cancelAttackPrice } from '../../services/cancel-price.js';
import { computeCharacterValue } from '../../services/character-value.js';

/** A character's printed name, for a rationale. */
function nameOfCharacter(context: ModuleContext, instanceId: CardInstanceId): string {
  const character = context.view.self.characters[instanceId];
  const name = character
    ? context.cardPool[character.definitionId]?.name
    : undefined;
  return name ?? (instanceId as string);
}

/**
 * Action types this module scores.
 *
 * These overlap with `combat`, which also lists them. The registry resolves
 * ownership by module order and context gate, and `kill` gates on the *whole
 * attack still being refusable* — before any strike is assigned — which is
 * exactly the window where the portfolio question applies.
 */
const OWNED_ACTION_TYPES = ['cancel-attack', 'cancel-by-tap', 'halve-strikes', 'take-trophy'] as const;

/**
 * The bonus a character's trophies give, by the total marshalling points
 * printed on them (CoE 3.IV.3). Prowess from trophies applies only up to 9.
 */
function trophyBonus(printedMp: number): { influence: number; prowess: number } {
  if (printedMp >= 4) return { influence: 2, prowess: 2 };
  if (printedMp === 3) return { influence: 2, prowess: 1 };
  if (printedMp === 2) return { influence: 1, prowess: 1 };
  if (printedMp === 1) return { influence: 1, prowess: 0 };
  return { influence: 0, prowess: 0 };
}

/**
 * The kill points printed on a creature card, as CoE 3.IV.3 counts them, or
 * undefined when this seat cannot see which creature it is — a detainment kill
 * rests in the attacker's discard pile, which the view redacts.
 */
function printedKillMp(context: ModuleContext, definitionId: string): number | undefined {
  const def = context.cardPool[definitionId] as unknown as { killMarshallingPoints?: number } | undefined;
  return def ? def.killMarshallingPoints ?? 0 : undefined;
}

/** What an unseen trophy is assumed to carry: one point, as most creatures print. */
const UNSEEN_TROPHY_MP = 1;

/**
 * Score keeping a defeated creature as a trophy.
 *
 * Passing banks the same kill points (CoE 3.IV.2), so the trophy is worth
 * exactly what it adds: the bearer's rise in direct influence and prowess.
 * Nothing here prices a point of either, so each is credited at the flat tap
 * tempo — a floor, and enough to rank the play above a pass it never loses
 * to. Unowned, the decision fell back and the modular AI passed on every
 * trophy, where the winning human (game mv556rr7-1p305v, rated 1645) took one
 * after every fight their Orc and Troll leaders won.
 */
function evaluateTrophy(action: GameAction, context: ModuleContext): Evaluation | null {
  const fields = action as unknown as { characterId?: CardInstanceId; creatureInstanceId?: CardInstanceId };
  if (!fields.characterId || !fields.creatureInstanceId) return null;
  const character = context.view.self.characters[fields.characterId];
  if (!character) return null;
  // A defeated creature already rests in our kill pile — or, after a
  // detainment attack, in the attacker's discard pile (`handleTakeTrophy`).
  const creature = [...context.view.self.killPile, ...context.view.opponent.discardPile]
    .find(card => card.instanceId === fields.creatureInstanceId);
  if (!creature) return null;

  const held = (character.trophies ?? []).reduce(
    (sum, trophy) => sum + (printedKillMp(context, trophy.definitionId as string) ?? UNSEEN_TROPHY_MP), 0);
  const seen = printedKillMp(context, creature.definitionId as string);
  const adds = seen ?? UNSEEN_TROPHY_MP;
  const before = trophyBonus(held);
  const after = trophyBonus(held + adds);
  const prowess = character.effectiveStats.prowess;
  // Prowess bonuses from trophies apply to a maximum of 9 (CoE 3.IV.3).
  const prowessGain = Math.max(0, Math.min(after.prowess - before.prowess, 9 - prowess));
  const influenceGain = after.influence - before.influence;
  const { standing, tunables } = context;
  const worth = (influenceGain + prowessGain) * tunables.tapTempoCost;
  const name = nameOfCharacter(context, fields.characterId);

  return scoredEvaluation({
    action,
    module: 'kill',
    outcomes: [{
      p: 1,
      label: `${name} keeps the creature as a trophy — +${influenceGain} direct influence, +${prowessGain} prowess`,
      dtsd: netTsdDelta({ realized: worth, tempo: 0 }, tunables),
    }],
    standing,
    headline: 'take a trophy',
    detail: [node('the trophy', worth, [
      leaf('kill points', 0, {
        unit: 'tsd',
        note: 'banked whether or not the creature is kept — a trophy gives the points it would have (CoE 3.IV.2)',
      }),
      leaf('printed points on his trophies', held + adds, {
        unit: 'mp',
        note: seen === undefined
          ? `${held} before this one, which this seat cannot see and counts as ${UNSEEN_TROPHY_MP}`
          : `${held} before this one`,
      }),
      leaf('direct influence it adds', influenceGain),
      leaf('prowess it adds', prowessGain, { note: 'trophy prowess applies only up to 9' }),
      leaf('worth of each', tunables.tapTempoCost, {
        unit: 'tsd',
        tunable: 'tapTempoCost',
        note: 'a floor — nothing prices a point of influence or prowess, and neither is ever worth less than nothing',
      }),
    ], { unit: 'tsd' })],
    assumptions: [
      'a trophy counts as a minor item (CoE 3.IV.1): an effect triggered by gaining an item is not charged',
    ],
  });
}

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
    if (combat?.phase === 'trophy-offer') return combat.defendingPlayerId === context.view.self.id;
    if (!beforeAssignment(combat)) return false;
    if (combat!.defendingPlayerId !== context.view.self.id) return false;
    // Only worth claiming when there are points on the table. With no kill MP
    // this is pure harm avoidance and `combat` owns it.
    return killMpOnOffer(context.cardPool, combat!, context.view) > 0;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'take-trophy') return evaluateTrophy(action, context);
    const combat = context.view.combat;
    if (!combat) return null;
    const { standing, tunables } = context;
    const killMp = killMpOnOffer(context.cardPool, combat, context.view);
    if (killMp <= 0) return null;

    const killTsd = standing.tsdAfter({ kill: killMp }) - standing.tsd;
    // Refusing the attack costs the card or tap that refused it, and nothing
    // else is certain. The points it was offering are *not* charged here: the
    // candidates that face the attack are credited with them on the branches
    // that beat it (`combat`'s question), so a refusal priced at "the card
    // plus the kill given up" counted the same points twice — once as the
    // fight's upside and once as the refusal's loss — and made the module
    // fight attacks the exact lookahead (`oracle.test.ts`) says to refuse.
    // What is left on the table is reported, so the reader can see why the
    // fight looks attractive, but the price of refusing is the price alone.
    // A `cancel-attack` costs what it names — the card, the scout it taps, the
    // character it wounds — through the same service `combat` uses.
    const cancel = action.type === 'cancel-attack'
      ? cancelAttackPrice(action, computeCharacterValue(context.view, context.cardPool, standing, tunables),
        tunables, id => nameOfCharacter(context, id))
      : null;
    const price = cancel?.tsd
      ?? (action.type === 'cancel-by-tap' ? tunables.tapTempoCost : tunables.provisionalCardPrice);
    const forfeited = action.type === 'halve-strikes' ? killTsd / 2 : killTsd;
    const dtsd = netTsdDelta({ realized: 0, tempo: price }, tunables);

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
      leaf('left on the table by refusing', -forfeited, {
        unit: 'tsd',
        note: 'not charged here — the candidates that face the attack carry it on the branches that beat it',
      }),
      cancel
        ? node('price of refusing', price, cancel.parts, { unit: 'tsd' })
        : leaf('price of refusing', price, {
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
