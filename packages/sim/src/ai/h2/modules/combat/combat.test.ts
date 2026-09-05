/**
 * @module ai/h2/modules/combat/combat.test
 *
 * The module end to end, on the checked-in positions it is meant to handle.
 *
 * The dice mathematics is pinned in `strike-model.test.ts` and re-checked
 * against the real reducer by `npm run calibrate`; what is tested here is the
 * part a calibration run cannot see — that the module claims the right
 * decisions, prices the outcomes into one comparable currency, and explains
 * where every hand-chosen number came from.
 */

import { describe, test, expect } from 'vitest';
import { computeLegalActions, loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import type { Evaluation, ModuleContext, Rationale } from '../../core/types.js';
import type { Tunables } from '../../core/tunables.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { evaluateDecision } from '../../core/registry.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testWinProbModel } from '../../test-support.js';
import { combatModule } from './combat.js';

const CARD_POOL = loadCardPool();
const MODEL = testWinProbModel();

/** The module context for a checked-in scenario. */
function contextFor(scenarioId: string): ModuleContext {
  const scenario = loadScenario(scenarioId);
  const view = scenarioView(scenario);
  const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
  return {
    view,
    cardPool: CARD_POOL,
    legalActions,
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, MODEL, DEFAULT_TUNABLES),
  };
}

/** Evaluations for a scenario, ranked best first. */
function rank(scenarioId: string): readonly Evaluation[] {
  return evaluateDecision([combatModule], contextFor(scenarioId)).evaluations;
}

/** Every leaf of an evaluation's rationale tree, flattened. */
function leavesOf(evaluation: Evaluation): { label: string; value: unknown }[] {
  const out: { label: string; value: unknown }[] = [];
  const walk = (node: Rationale): void => {
    out.push({ label: node.label, value: node.value });
    for (const child of node.children ?? []) walk(child);
  };
  walk(evaluation.rationale);
  return out;
}

/** The evaluation of the first action matching a predicate. */
function find(evaluations: readonly Evaluation[], predicate: (a: GameAction) => boolean): Evaluation | undefined {
  return evaluations.find(e => predicate(e.action));
}

/** Whether an action is `resolve-strike` with the given tap mode. */
function isResolve(tapToFight: boolean) {
  return (action: GameAction): boolean =>
    action.type === 'resolve-strike'
    && (action as unknown as { tapToFight?: boolean }).tapToFight === tapToFight;
}

const STRIKE_SCENARIOS = [
  'combat/first-strike-resolution',
  'combat/creature-with-body',
  'combat/strike-event-in-hand',
  'combat/two-strike-attack',
];

describe('claiming decisions', () => {
  test.each(STRIKE_SCENARIOS)('claims the strike window in %s', scenarioId => {
    expect(combatModule.claims!(contextFor(scenarioId))).toBe(true);
  });

  test('declines a decision with no combat in progress', () => {
    // Combat is a phase-independent sub-state, so the phase alone would not
    // identify it — the module checks the combat itself.
    expect(combatModule.claims!(contextFor('organization/turn14-company-planning'))).toBe(false);
  });

  test('scores every candidate it claims, so the ranking is in one currency', () => {
    for (const scenarioId of STRIKE_SCENARIOS) {
      const context = contextFor(scenarioId);
      const { modules, evaluations } = evaluateDecision([combatModule], context);
      expect(modules).toEqual(['combat']);
      expect(evaluations).toHaveLength(context.legalActions.length);
      for (const evaluation of evaluations) {
        expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 9);
        expect(Number.isFinite(evaluation.utility)).toBe(true);
      }
    }
  });

  test('ranks best first', () => {
    for (const scenarioId of STRIKE_SCENARIOS) {
      const evaluations = rank(scenarioId);
      for (let i = 1; i < evaluations.length; i++) {
        expect(evaluations[i - 1].utility).toBeGreaterThanOrEqual(evaluations[i].utility);
      }
    }
  });
});

describe('facing a dangerous strike', () => {
  // first-strike-resolution: tapping needs 4, staying untapped needs 7 — a
  // 2.8% chance of being struck against 25%.
  const evaluations = rank('combat/first-strike-resolution');

  test('tapping to fight beats staying untapped when the strike can wound', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false));
    if (untap) expect(tap.utility).toBeGreaterThan(untap.utility);
  });

  test('the safer option is also the one with less spread', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false));
    if (untap) expect(tap.sigmaTsd).toBeLessThan(untap.sigmaTsd);
  });
});

describe('facing a harmless strike', () => {
  // creature-with-body: the character out-prowesses the attack, so tapping is
  // a certain parry — but staying untapped costs almost nothing and keeps the
  // character available for the site phase, which is what the tap tempo term
  // exists to notice.
  const evaluations = rank('combat/creature-with-body');

  test('staying untapped is preferred when the strike is unlikely to land', () => {
    const tap = find(evaluations, isResolve(true))!;
    const untap = find(evaluations, isResolve(false))!;
    expect(untap.utility).toBeGreaterThan(tap.utility);
  });
});

describe('spending a card', () => {
  const evaluations = rank('combat/strike-event-in-hand');

  test('charges the card against every outcome, not only the good ones', () => {
    const card = find(evaluations, a => a.type === 'play-strike-event');
    if (!card) return;
    // Comparing the card option against a *different* option would conflate
    // the price with everything else that differs. Re-evaluating the same
    // option with the price set to zero isolates it exactly: the card is paid
    // for whether or not the dice cooperate, so the whole expectation moves by
    // the full price.
    const free = { ...contextFor('combat/strike-event-in-hand'), tunables: { ...DEFAULT_TUNABLES, provisionalCardPrice: 0 } };
    const unpriced = combatModule.evaluate(card.action, free)!;
    expect(unpriced.expectedTsd - card.expectedTsd).toBeCloseTo(DEFAULT_TUNABLES.provisionalCardPrice, 9);
    expect(collectTunables(card.rationale).has('provisionalCardPrice')).toBe(true);
  });
});

describe('supporting a strike', () => {
  // support-strike-tap-cost: Halbarad (0 MP) faces the first of a two-strike
  // attack, with four untapped company mates able to support — one of them,
  // Thranduil, is the company's only character with free direct influence
  // left, so tapping him forfeits an influence attempt the other three do not.
  const evaluations = rank('combat/support-strike-tap-cost');
  const isSupport = (supporterId: string) => (action: GameAction): boolean =>
    action.type === 'support-strike'
    && (action as unknown as { supportingCharacterId?: string }).supportingCharacterId === supporterId;

  test('a supporter who forfeits an influence attempt is priced above a flat tap', () => {
    const bestInfluencer = find(evaluations, isSupport('p2-109'))!;
    const spare = find(evaluations, isSupport('p2-98'))!;
    // Both supporters buy the same improved strike, so any utility gap is the
    // tap price alone — and a flat tunable would have priced them identically.
    expect(bestInfluencer.utility).toBeLessThan(spare.utility);
  });

  test('explains the forfeited influence attempt, not just a flat tap', () => {
    const bestInfluencer = find(evaluations, isSupport('p2-109'))!;
    const spare = find(evaluations, isSupport('p2-98'))!;
    expect(collectTunables(bestInfluencer.rationale).has('tapTempoCost')).toBe(true);
    expect(JSON.stringify(bestInfluencer.rationale)).toContain('influence attempt forfeited');
    expect(JSON.stringify(spare.rationale)).not.toContain('influence attempt forfeited');
  });
});

describe('explanations', () => {
  test('name every constant they used', () => {
    for (const evaluation of rank('combat/first-strike-resolution')) {
      const named = collectTunables(evaluation.rationale);
      expect(named.has('tapTempoCost')).toBe(true);
      expect(named.has('woundTempoCost')).toBe(true);
      expect(named.has('eliminationTempoCost')).toBe(true);
    }
  });

  test('declare what the module does not model', () => {
    for (const evaluation of rank('combat/first-strike-resolution')) {
      expect(evaluation.assumptions).toContain('the attacker plays no cards into this combat');
    }
  });

  test('report the outcome distribution the calibration harness checks', () => {
    const tap = find(rank('combat/two-strike-attack'), isResolve(true))!;
    expect(tap.outcomes.length).toBeGreaterThan(0);
    for (const outcome of tap.outcomes) {
      expect(outcome.p).toBeGreaterThan(0);
      expect(outcome.label.length).toBeGreaterThan(0);
    }
  });
});

describe('kill marshalling points', () => {
  test('are discounted while other strikes are still unresolved', () => {
    // two-strike-attack: defeating this strike unlocks the points but does not
    // bank them, which is what stops a single parry reading as income.
    const evaluation = find(rank('combat/two-strike-attack'), isResolve(true))!;
    const defeated = evaluation.outcomes.find(o => o.label.includes('strike defeated'));
    expect(defeated?.label).not.toContain('attack beaten');
  });
});

describe('cancelling a strike after assignment', () => {
  // Bug report: facing Assassin (tw-8), which assigns all 3 of its strikes to
  // one character up front, the AI never used cancel-by-tap across three
  // separate opportunities and instead tapped a companion to support the
  // final strike — which still left the struck character exposed to a wound.
  // Root cause: the module only routed cancel-by-tap, cancel-attack and
  // halve-strikes through `evaluateAttackWindow` while `!hasCurrentStrike`,
  // but a multi-attack creature that pre-assigns every strike makes
  // `hasCurrentStrike` true for the whole cancel-by-tap sub-phase, so those
  // candidates fell through to the switch, where they are unowned and
  // silently dropped from the ranking (CRF 22 explicitly allows cancelling
  // by tap even after strikes are assigned and after facing another attack).
  const evaluations = rank('combat/assassin-cancel-by-tap-after-assignment');
  const isCancelByTap = (characterId: string) => (action: GameAction): boolean =>
    action.type === 'cancel-by-tap'
    && (action as unknown as { characterId?: string }).characterId === characterId;

  test('claims cancel-by-tap once strikes are already assigned to a target', () => {
    const cancel = find(evaluations, isCancelByTap('p2-103'));
    expect(cancel).toBeDefined();
  });

  test('a cancelled strike forfeits the kill: the cancel never banks the attack', () => {
    // A cancelled strike is not a defeated one (`combat-finalize.ts` awards
    // the kill only when every assigned strike succeeded), so the branches
    // after a cancel-by-tap must not carry the "attack beaten" credit that
    // facing the strikes could earn. The exact-lookahead oracle
    // (`oracle.test.ts`) is what decides whether cancelling is *preferred*.
    const cancel = find(evaluations, isCancelByTap('p2-103'))!;
    expect(cancel.outcomes.some(o => o.label.includes('attack beaten'))).toBe(false);
    const declined = find(evaluations, a => a.type === 'pass')!;
    expect(declined).toBeDefined();
  });
});

describe('choosing which strike resolves next', () => {
  test('every candidate is scored — the decision is claimed, not just owned', () => {
    // At this step there is deliberately no *current* strike: picking one is
    // the decision. The module used to handle ordering only inside the
    // strike-window switch, which that branch never reaches, so it claimed the
    // decision and then declined every candidate on it — 124 times in three
    // self-play games, and indistinguishable in `coverage` from an action type
    // nobody owns.
    const scenario = loadScenario('combat/choose-strike-order');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    const ordering = legalActions.filter(a => a.type === 'choose-strike-order');
    expect(ordering.length).toBeGreaterThan(1);

    const context: ModuleContext = {
      view,
      cardPool,
      legalActions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    expect(combatModule.claims!(context)).toBe(true);
    for (const action of ordering) {
      expect(combatModule.evaluate(action, context)).not.toBeNull();
    }
  });

  test('it names the character facing each strike, not the strike index', () => {
    const scenario = loadScenario('combat/choose-strike-order');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const legalActions = computeLegalActions(scenario.state, scenario.actingPlayer)
      .filter(legal => legal.viable)
      .map(legal => legal.action);
    const context: ModuleContext = {
      view,
      cardPool,
      legalActions,
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    const first = legalActions.find(a => a.type === 'choose-strike-order')!;
    const evaluation = combatModule.evaluate(first, context)!;
    // The action's own `characterId` is documented as informational and the
    // engine may omit it; the authority is `strikeIndex` into the assignments.
    expect(evaluation.outcomes[0].label).not.toMatch(/^p\d+-\d+/);
  });
});

describe('the defender\'s own assignment window', () => {
  // A six-strike attack on a two-character company, one strike already
  // assigned, the defender still holding the assignment for the other five.
  const SCENARIO = 'combat/mid-assignment-window';

  test('prices the whole attack, not just the strikes handed out so far', () => {
    // Nothing has resolved while the attack is still being assigned, so all six
    // strikes are still to come. Counting the assignments made instead read
    // this as a one-strike attack — and the decision is precisely about the
    // five strikes that are *not* in that count.
    const context = contextFor(SCENARIO);
    const combat = context.view.combat!;
    expect(combat.strikesTotal).toBe(6);
    expect(combat.strikeAssignments).toHaveLength(1);
    const evaluation = combatModule.evaluate(
      context.legalActions.find(a => a.type === 'assign-strike')!, context)!;
    expect(leavesOf(evaluation).find(l => l.label === 'strikes faced')?.value).toBe(6);
  });

  test('the strikes already assigned stay on the characters they were given to', () => {
    const context = contextFor(SCENARIO);
    const assigned = context.view.combat!.strikeAssignments[0].characterId;
    const evaluation = combatModule.evaluate(
      context.legalActions.find(a => a.type === 'assign-strike')!, context)!;
    const opening = leavesOf(evaluation).filter(l => l.label.startsWith('strike 1 →'));
    expect(opening).toHaveLength(1);
    // The projection names the character, so the settled strike is identified
    // by not being the one this candidate is assigning.
    const target = (context.legalActions.find(a => a.type === 'assign-strike') as unknown as
      { characterId: string }).characterId;
    expect(target).not.toBe(assigned);
    expect(opening[0].label).not.toContain(target);
  });

  test('passing is worse than assigning, because the attacker assigns what is left', () => {
    // `handleCombatPass`: "Defender passed — n strike(s) remaining, attacker
    // assigns". Pricing that as the attack the defence would have arranged for
    // itself made passing weakly dominant by construction — the sequence
    // answers every strike with the best remaining parrier either way, so
    // forcing one onto a named character could only score lower. On this
    // position the two came out equal to five decimal places, and across ten
    // recorded human games the AI passed 33 of the 86 assignment decisions the
    // human answered by assigning.
    const evaluations = rank(SCENARIO);
    const pass = find(evaluations, a => a.type === 'pass')!;
    const assign = find(evaluations, a => a.type === 'assign-strike')!;
    expect(assign.utility).toBeGreaterThan(pass.utility);
    expect(evaluations[0].action.type).toBe('assign-strike');
  });

  test('says out loud what it assumes the attacker would do with the assignment', () => {
    const pass = find(rank(SCENARIO), a => a.type === 'pass')!;
    expect(pass.assumptions.join(' ')).toMatch(/attacker assigning every unallocated strike/);
  });

  test('leaves the pre-assignment cancel window alone', () => {
    // Passing *there* really is "take the attack as it stands": the defender
    // keeps the assignment, so the best-parrier projection is the right one and
    // this change must not reach it.
    const context = contextFor('combat/two-strike-attack');
    const combat = context.view.combat!;
    expect(combat.assignmentPhase).not.toBe('defender');
    const pass = context.legalActions.find(a => a.type === 'pass');
    if (pass) {
      expect(combatModule.evaluate(pass, context)!.assumptions.join(' '))
        .not.toMatch(/attacker assigning every unallocated strike/);
    }
  });
});

describe('the handed-assignment off-switch', () => {
  const SCENARIO = 'combat/mid-assignment-window';

  /** The module's ranking with one tunable overridden. */
  function rankWith(scenarioId: string, pessimism: number): readonly Evaluation[] {
    const context = contextFor(scenarioId);
    return evaluateDecision([combatModule], {
      ...context,
      tunables: { ...DEFAULT_TUNABLES, handedAssignmentPessimism: pessimism },
    }).evaluations;
  }

  test('at zero it is the projection the module used to make', () => {
    // Which is what makes "was this worth anything" a gate question rather than
    // an argument: `--champion h2:all/handedAssignmentPessimism=0` is the same
    // binary with only this reading changed.
    const evaluations = rankWith(SCENARIO, 0);
    const pass = find(evaluations, a => a.type === 'pass')!;
    const assign = find(evaluations, a => a.type === 'assign-strike')!;
    expect(pass.utility).toBeCloseTo(assign.utility, 9);
  });

  test('it is monotone: the more the attacker uses it, the less passing is worth', () => {
    const utilityAt = (pessimism: number): number =>
      find(rankWith(SCENARIO, pessimism), a => a.type === 'pass')!.utility;
    expect(utilityAt(0.5)).toBeLessThan(utilityAt(0));
    expect(utilityAt(1)).toBeLessThan(utilityAt(0.5));
  });

  test('a mixture is still a distribution', () => {
    const pass = find(rankWith(SCENARIO, 0.5), a => a.type === 'pass')!;
    expect(pass.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 9);
  });
});

describe('a tie in the defender\'s assignment window', () => {
  // assign-two-strikes: a two-strike attack the defender still holds the
  // assignment for, and the shape the corpus is actually made of — the
  // attacker's pick and the defence's best parrier name the same character, so
  // the two projections agree to the last decimal. Priced on the projection
  // alone the decision is a coin flip, and half of those flips hand the
  // opponent a choice the defender could have made himself.
  const SCENARIO = 'combat/assign-two-strikes';

  /** The module's ranking with tunables overridden. */
  function rankWith(scenarioId: string, overrides: Partial<Tunables>): readonly Evaluation[] {
    const context = contextFor(scenarioId);
    return evaluateDecision([combatModule], {
      ...context,
      tunables: { ...DEFAULT_TUNABLES, ...overrides },
    }).evaluations;
  }

  test('the two projections really do coincide here', () => {
    const evaluations = rankWith(SCENARIO, { concededAssignmentTsd: 0 });
    const pass = find(evaluations, a => a.type === 'pass')!;
    const assign = find(evaluations, a => a.type === 'assign-strike')!;
    expect(pass.utility).toBeCloseTo(assign.utility, 9);
  });

  test('and the tie goes to the seat that keeps the choice', () => {
    // Not a preference invented to make the number come out: whatever the
    // attacker would do with the assignment the defence could have done to
    // itself, so the choice set passing gives away is a subset of the one it
    // keeps, and keeping it cannot come out worse.
    const evaluations = rank(SCENARIO);
    const pass = find(evaluations, a => a.type === 'pass')!;
    const assign = find(evaluations, a => a.type === 'assign-strike')!;
    expect(assign.utility).toBeGreaterThan(pass.utility);
    // The whole gap is the margin and nothing else — the two are the same
    // attack, so anything wider would be a difference the model invented.
    expect(assign.expectedTsd - pass.expectedTsd)
      .toBeCloseTo(DEFAULT_TUNABLES.concededAssignmentTsd, 9);
    expect(collectTunables(pass.rationale).has('concededAssignmentTsd')).toBe(true);
  });

  test('nothing is conceded in a window the defender is not assigning in', () => {
    // Assassin (tw-8) assigned every strike itself; what reopens is the
    // cancel-by-tap window, where passing declines to spend a tap and hands
    // over nothing.
    const ASSASSIN = 'combat/assassin-cancel-by-tap-after-assignment';
    const charged = find(rank(ASSASSIN), a => a.type === 'pass')!;
    const free = find(rankWith(ASSASSIN, { concededAssignmentTsd: 0 }), a => a.type === 'pass')!;
    expect(charged.expectedTsd).toBe(free.expectedTsd);
  });

  test('the off-switch takes the margin with the reading it belongs to', () => {
    // At `handedAssignmentPessimism=0` the model says the attacker makes no use
    // of what he was handed, so there is nothing conceded to charge for and the
    // gate compares two whole readings rather than one and a half.
    const evaluations = rankWith(SCENARIO, { handedAssignmentPessimism: 0 });
    const pass = find(evaluations, a => a.type === 'pass')!;
    const assign = find(evaluations, a => a.type === 'assign-strike')!;
    expect(pass.utility).toBeCloseTo(assign.utility, 9);
  });
});
