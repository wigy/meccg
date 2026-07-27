/**
 * @module ai/h2/modules/combat/combat
 *
 * The `combat` module — the strike window.
 *
 * This is the first Heuristics-2 evaluation module, and it is deliberately the
 * first: a strike is closed-form. The engine publishes the modified 2d6 target
 * on every option it offers, so the probability of each outcome is exact
 * rather than estimated, and the only judgement left is what each outcome is
 * worth. That makes the module's claims checkable against the reducer, which
 * is the property H1's weights can never have.
 *
 * It owns the defender's decisions inside one strike: tap to fight or stay
 * untapped, tap a companion to support, and play a strike event from hand. Our
 * own hand cards are in scope from the start (plan §3.3) — they are the main
 * lever a defender has over a bad attack, and H1's blindness to them is why it
 * loses characters it did not have to lose. A card is only spent when the TSD
 * it saves beats its shadow price.
 *
 * What is *not* modelled is recorded on every evaluation: the attacker is
 * assumed to play nothing into the defence (the `hand-cards` belief refinement
 * of §8 relaxes that), and the attack-level decisions taken before assignment
 * — cancelling the attack, cancel-by-tap, halving strikes — belong to a
 * whole-attack model that is not this one.
 */

import type { CardDefinition, CardInstanceId, CombatState, GameAction, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { Tunables } from '../../core/tunables.js';
import { netTsdDelta } from '../../core/tsd.js';
import { pBodyCheckFailed } from '../../core/dice.js';
import { leaf, node } from '../../core/rationale.js';
import type { Standing } from '../../services/standing.js';
import type { StrikeOption, StrikeOutcome, StrikeSituation, TapMode } from './strike-model.js';
import { strikeOutcomes } from './strike-model.js';
import type { EliminationCost } from './mp-value.js';
import { attackStillDefeatable, eliminationCost, killMpOnOffer, strikeCompletesTheAttack } from './mp-value.js';

/**
 * Action types this module scores.
 *
 * `body-check-roll` is deliberately absent: the *attacking* player rolls every
 * body check in creature combat, including the one against our own character
 * (`handleBodyCheckRoll`), so a defending module would never be offered it —
 * and the only case where the defender does roll is a CvCC check against an
 * attacking character, where the value of failing is inverted. Claiming it
 * would be claiming a decision this module does not model.
 */
const OWNED_ACTION_TYPES = [
  'resolve-strike',
  'play-strike-event',
  'support-strike',
  'pass',
] as const;

/** Combat sub-phase the strike window covers. */
const OWNED_COMBAT_PHASES = new Set(['resolve-strike']);

/** Default body for a character whose definition does not print one. */
const DEFAULT_BODY = 9;

/** Everything derived once per decision and shared by every candidate. */
interface StrikeContext {
  readonly view: PlayerView;
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  readonly tunables: Tunables;
  readonly standing: Standing;
  readonly combat: CombatState;
  /** The character (or ally) facing the current strike. */
  readonly targetId: CardInstanceId;
  /** Fixed properties of the strike being resolved. */
  readonly situation: StrikeSituation;
  /** MP consequence of losing the struck character. */
  readonly elimination: EliminationCost;
  /** TSD gained by banking the attack's kill MP, or 0 when there is none. */
  readonly killTsd: number;
  /** Kill MP on offer, for the rationale. */
  readonly killMp: number;
  /** Whether defeating this strike would complete the attack. */
  readonly completesAttack: boolean;
  /** Whether the attack can still be defeated at all. */
  readonly stillDefeatable: boolean;
  /** Whether the target was already tapped or wounded before this strike. */
  readonly alreadyTappedOrWounded: boolean;
}

/** Find a character or ally in the acting player's company by instance ID. */
function findTargetStatus(view: PlayerView, targetId: CardInstanceId): CardStatus | null {
  const character = view.self.characters[targetId];
  if (character) return character.status;
  for (const host of Object.values(view.self.characters)) {
    for (const ally of host.allies) if (ally.instanceId === targetId) return ally.status;
  }
  return null;
}

/** Printed body of a character or ally definition. */
function bodyOf(cardPool: Readonly<Record<string, CardDefinition>>, view: PlayerView, targetId: CardInstanceId): number {
  const character = view.self.characters[targetId];
  const definitionId = character?.definitionId
    ?? Object.values(view.self.characters)
      .flatMap(host => host.allies)
      .find(ally => ally.instanceId === targetId)?.definitionId;
  const def = definitionId ? cardPool[definitionId] : undefined;
  const body = (def as unknown as { body?: number } | undefined)?.body;
  return typeof body === 'number' ? body : DEFAULT_BODY;
}

/** Character IDs of the company under attack. */
function companyCharacters(view: PlayerView, combat: CombatState): readonly CardInstanceId[] {
  return view.self.companies.find(c => c.id === combat.companyId)?.characters ?? [];
}

/** Build the per-decision context, or null when this is not our strike to face. */
function buildContext(context: ModuleContext): StrikeContext | null {
  const { view, cardPool, tunables, standing } = context;
  const combat = view.combat;
  if (!combat || combat.defendingPlayerId !== view.self.id) return null;
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike) return null;

  const status = findTargetStatus(view, strike.characterId);
  if (status === null) return null;

  const situation: StrikeSituation = {
    creatureBody: combat.creatureBody,
    detainment: combat.detainment,
    characterBody: bodyOf(cardPool, view, strike.characterId),
    alreadyWounded: status === CardStatus.Inverted,
    bodyCheckModifier: combat.bodyCheckModifier ?? 0,
  };

  const killMp = killMpOnOffer(cardPool, combat, view);
  return {
    view,
    cardPool,
    tunables,
    standing,
    combat,
    targetId: strike.characterId,
    situation,
    elimination: eliminationCost(view, cardPool, strike.characterId, companyCharacters(view, combat)),
    killTsd: killMp > 0 ? standing.tsdAfter({ kill: killMp }) - standing.tsd : 0,
    killMp,
    completesAttack: strikeCompletesTheAttack(combat),
    stillDefeatable: attackStillDefeatable(combat),
    alreadyTappedOrWounded: status !== CardStatus.Untapped,
  };
}

/** TSD delta of one joint strike outcome, and the terms that produced it. */
function outcomeValue(context: StrikeContext, outcome: StrikeOutcome, extraTempo: number): number {
  const { tunables } = context;
  let realized = 0;
  let potential = 0;
  let tempo = extraTempo;

  switch (outcome.character) {
    case 'untapped':
      break;
    case 'tapped':
      // Tapping a character that was already tapped or wounded costs nothing
      // more — the capability was gone before the strike.
      if (!context.alreadyTappedOrWounded) tempo += tunables.tapTempoCost;
      break;
    case 'wounded':
      if (!context.situation.alreadyWounded) tempo += tunables.woundTempoCost;
      break;
    case 'eliminated':
      realized += context.standing.tsdAfter(context.elimination.delta) - context.standing.tsd;
      tempo += tunables.eliminationTempoCost;
      break;
  }

  if (outcome.strike === 'defeated' && context.killTsd > 0 && context.stillDefeatable) {
    // All-or-nothing per CoE 3.v: the points are banked only when this defeat
    // completes the attack. Otherwise they are unlocked, not earned, and the
    // potential discount is what stops a single parry reading as income.
    if (context.completesAttack) realized += context.killTsd;
    else potential += context.killTsd;
  }

  return netTsdDelta({ realized, potential, tempo }, tunables);
}

/** Human-readable label for a joint outcome. */
function outcomeLabel(context: StrikeContext, outcome: StrikeOutcome): string {
  const character = outcome.character === 'untapped' ? 'unharmed' : outcome.character;
  switch (outcome.strike) {
    case 'defeated':
      return context.completesAttack && context.killMp > 0
        ? `strike defeated — attack beaten, ${context.killMp} kill MP; character ${character}`
        : `strike defeated; character ${character}`;
    case 'survived': return `parried but the attack survives its body check; character ${character}`;
    case 'tie': return `tie — ineffectual (CoE 8.19); character ${character}`;
    case 'struck': return `strike gets through; character ${character}`;
  }
}

/** Convert strike outcomes into the common-currency distribution. */
function toOutcomes(context: StrikeContext, raw: readonly StrikeOutcome[], extraTempo: number): Outcome[] {
  return raw.map(outcome => ({
    p: outcome.p,
    label: outcomeLabel(context, outcome),
    dtsd: outcomeValue(context, outcome, extraTempo),
  }));
}

/** The rationale shared by every strike-facing option. */
function strikeRationale(
  context: StrikeContext,
  option: StrikeOption,
  raw: readonly StrikeOutcome[],
  label: string,
  extra: readonly Rationale[],
): Rationale {
  const { situation } = context;
  const win = raw.filter(o => o.strike === 'defeated' || o.strike === 'survived').reduce((s, o) => s + o.p, 0);
  const tie = raw.filter(o => o.strike === 'tie').reduce((s, o) => s + o.p, 0);
  const eliminated = raw.filter(o => o.character === 'eliminated').reduce((s, o) => s + o.p, 0);

  const children: Rationale[] = [
    leaf('need on 2d6', option.need, { note: 'published by the engine on the action' }),
    leaf('P(parry)', win, { unit: 'p', note: option.bestOfTwo ? 'better of two rolls' : 'single roll' }),
    leaf('P(tie)', tie, { unit: 'p', note: 'CoE 3.iv.7 — ineffectual, not a defeat' }),
  ];
  if (situation.creatureBody !== null) {
    children.push(leaf('P(attack body check fails | parry)', pBodyCheckFailed(situation.creatureBody), {
      unit: 'p',
      note: `body ${situation.creatureBody}; only a failed check defeats the strike (CoE 3.iv.7)`,
    }));
  }
  children.push(node('if the strike gets through', eliminated, [
    leaf('character body', situation.characterBody + option.bodyPenalty, {
      note: option.bodyPenalty ? `printed ${situation.characterBody}, modified ${option.bodyPenalty}` : 'printed',
    }),
    leaf('already wounded', situation.alreadyWounded ? 1 : 0, { note: '+1 on the body check (CoE 3.I)' }),
    leaf('MP lost on elimination', -(context.elimination.characterMp + context.elimination.lostItemMp), {
      unit: 'mp',
      note: `character ${context.elimination.characterMp}, items ${context.elimination.lostItemMp} of ${context.elimination.carriedItems}`
        + ` (${context.elimination.salvageableItems} salvageable, CoE 3.I.2)`,
    }),
    leaf('elimination tempo', context.tunables.eliminationTempoCost, { unit: 'tsd', tunable: 'eliminationTempoCost' }),
  ], { unit: 'p' }));

  if (context.killMp > 0) {
    children.push(leaf('kill MP if the whole attack is defeated', context.killTsd, {
      unit: 'tsd',
      note: context.completesAttack
        ? 'this strike would complete it'
        : `${context.combat.strikesTotal} strikes — discounted as potential`,
      tunable: context.completesAttack ? undefined : 'potentialDiscount',
    }));
  }
  children.push(leaf('tap tempo', context.tunables.tapTempoCost, { unit: 'tsd', tunable: 'tapTempoCost' }));
  children.push(leaf('wound tempo', context.tunables.woundTempoCost, { unit: 'tsd', tunable: 'woundTempoCost' }));
  children.push(...extra);

  return node(label, option.need, children);
}

/** Assumptions every evaluation from this module rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the attacker plays no cards into this combat',
  'marshalling-point loss is computed from printed card values, without the engine\'s alignment clamps',
  'item and global body-check modifiers are not modelled',
];

/** Build a complete evaluation from a strike option. */
function evaluateOption(
  context: StrikeContext,
  action: GameAction,
  option: StrikeOption,
  label: string,
  extraTempo: number,
  extraRationale: readonly Rationale[],
  extraAssumptions: readonly string[] = [],
): Evaluation {
  const raw = strikeOutcomes(option, context.situation);
  const outcomes = toOutcomes(context, raw, extraTempo);
  const scored = context.standing.score(outcomes);
  return {
    action,
    module: 'combat',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(label, scored.utility, [
      strikeRationale(context, option, raw, 'strike', extraRationale),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [...ASSUMPTIONS, ...extraAssumptions],
  };
}

/**
 * The structured outcome distribution the module claims for a strike action,
 * or null when the action is not one it models with dice.
 *
 * Exported for the calibration harness (§6.2), which replays the same action
 * through the real reducer and checks these probabilities. It is deliberately
 * the same code path the evaluation uses: a harness that measured a
 * reimplementation would only prove the two agreed with each other.
 */
export function claimedStrikeOutcomes(action: GameAction, context: ModuleContext): readonly StrikeOutcome[] | null {
  const ctx = buildContext(context);
  if (!ctx) return null;
  const option = strikeOptionFor(action, ctx, context);
  return option ? strikeOutcomes(option, ctx.situation) : null;
}

/** The strike option an action represents, or null if it is not one. */
function strikeOptionFor(action: GameAction, ctx: StrikeContext, context?: ModuleContext): StrikeOption | null {
  if (action.type === 'support-strike' && context) {
    // A support tap does not resolve the strike; the claim is about the strike
    // that follows it, faced by tapping to fight one point lower.
    const base = bestResolveNeed(context);
    return base === null ? null : { need: Math.max(2, base - 1), tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 };
  }
  const need = (action as unknown as { need?: number }).need;
  if (typeof need !== 'number') return null;
  if (action.type === 'resolve-strike') {
    const tapToFight = (action as unknown as { tapToFight?: boolean }).tapToFight === true;
    return { need, tapMode: tapToFight ? 'always' : 'tie-only', bestOfTwo: false, bodyPenalty: 0 };
  }
  if (action.type === 'play-strike-event') {
    const cardInstanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    const modifier = cardInstanceId ? strikeModifierOf(ctx, cardInstanceId) : null;
    if (!modifier) return null;
    return {
      need,
      tapMode: modifier.dodge ? 'never' : 'always',
      bestOfTwo: modifier.reroll,
      bodyPenalty: modifier.bodyPenalty,
    };
  }
  return null;
}

/** The `strike-modifier` effect of a hand card, if it carries one. */
function strikeModifierOf(
  context: StrikeContext,
  cardInstanceId: CardInstanceId,
): { dodge: boolean; reroll: boolean; bodyPenalty: number } | null {
  const card = context.view.self.hand.find(c => c.instanceId === cardInstanceId);
  const def = card ? context.cardPool[card.definitionId] : undefined;
  const effects = (def as unknown as { effects?: readonly { type: string; dodge?: true; reroll?: true; bodyPenalty?: number }[] } | undefined)?.effects;
  const effect = effects?.find(e => e.type === 'strike-modifier');
  if (!effect) return null;
  return { dodge: effect.dodge === true, reroll: effect.reroll === true, bodyPenalty: effect.bodyPenalty ?? 0 };
}

/** The best `need` currently on offer for simply facing the strike. */
function bestResolveNeed(context: ModuleContext): number | null {
  let best: number | null = null;
  for (const action of context.legalActions) {
    if (action.type !== 'resolve-strike') continue;
    const need = (action as unknown as { need?: number }).need;
    if (typeof need !== 'number') continue;
    if (best === null || need < best) best = need;
  }
  return best;
}

/**
 * The strike-window module. Claims a decision only when every candidate is one
 * of its own actions *and* the game is in a strike it is defending — combat is
 * a phase-independent sub-state, so phase alone would not identify it.
 */
export const combatModule: H2Module = {
  name: 'combat',
  ownedActionTypes: OWNED_ACTION_TYPES,

  claims(context: ModuleContext): boolean {
    const combat = context.view.combat;
    if (!combat || !OWNED_COMBAT_PHASES.has(combat.phase)) return false;
    if (combat.defendingPlayerId !== context.view.self.id) return false;
    if (context.legalActions.length === 0) return false;
    const owned = new Set<string>(OWNED_ACTION_TYPES);
    return context.legalActions.every(a => owned.has(a.type));
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const ctx = buildContext(context);
    if (!ctx) return null;

    switch (action.type) {
      case 'resolve-strike': {
        const need = (action as unknown as { need?: number }).need;
        const tapToFight = (action as unknown as { tapToFight?: boolean }).tapToFight === true;
        if (typeof need !== 'number') return null;
        const tapMode: TapMode = tapToFight ? 'always' : 'tie-only';
        return evaluateOption(
          ctx,
          action,
          { need, tapMode, bestOfTwo: false, bodyPenalty: 0 },
          tapToFight ? 'tap to fight' : 'stay untapped',
          0,
          [leaf('tap mode', tapToFight ? 'taps on any non-wounding result' : 'stays untapped unless the exchange ties')],
        );
      }

      case 'play-strike-event': {
        const need = (action as unknown as { need?: number }).need;
        const cardInstanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
        if (typeof need !== 'number' || !cardInstanceId) return null;
        const modifier = strikeModifierOf(ctx, cardInstanceId);
        if (!modifier) return null;
        const tapMode: TapMode = modifier.dodge ? 'never' : 'always';
        return evaluateOption(
          ctx,
          action,
          { need, tapMode, bestOfTwo: modifier.reroll, bodyPenalty: modifier.bodyPenalty },
          modifier.dodge ? 'dodge the strike' : modifier.reroll ? 'reroll the strike' : 'play a strike event',
          // The card is spent whatever the dice say, so its price is charged
          // against every outcome rather than only the ones that go well.
          ctx.tunables.provisionalCardPrice,
          [leaf('card price', ctx.tunables.provisionalCardPrice, {
            unit: 'tsd',
            tunable: 'provisionalCardPrice',
            note: 'flat placeholder until the `hand` module prices cards (plan §3.5)',
          })],
          ['the spent card had no better use later — a flat price, not a shadow price'],
        );
      }

      case 'support-strike': {
        const need = bestResolveNeed(context);
        if (need === null) return null;
        const supporterId = (action as unknown as { supportingCharacterId?: CardInstanceId }).supportingCharacterId;
        // CoE 3.iv.4: each supporter taps for +1 prowess, which lowers the
        // target by one. The value of supporting is the improved strike minus
        // the supporter's tap.
        const supported: StrikeOption = { need: Math.max(2, need - 1), tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 };
        return evaluateOption(
          ctx,
          action,
          supported,
          'tap a companion to support',
          ctx.tunables.tapTempoCost,
          [
            leaf('support bonus', 1, { note: 'CoE 3.iv.4 — +1 prowess, one lower on the die' }),
            leaf('supporter tapped', supporterId ? (supporterId as string) : 'unknown', { note: 'cannot tap again this site phase' }),
          ],
          ['the supported strike is then faced by tapping to fight'],
        );
      }

      case 'pass':
        // Offered only when the strike's target has already left play, so the
        // strike is skipped: a certain, valueless action.
        return {
          action,
          module: 'combat',
          outcomes: [{ p: 1, label: 'the strike is skipped — its target has left play', dtsd: 0 }],
          expectedTsd: 0,
          sigmaTsd: 0,
          utility: 0,
          method: 'integrated',
          rationale: leaf('skip the strike', 0, { unit: 'tsd', note: 'no target remains' }),
          assumptions: ASSUMPTIONS,
        };

      default:
        return null;
    }
  },
};
