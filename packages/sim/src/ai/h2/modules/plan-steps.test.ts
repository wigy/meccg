/**
 * @module ai/h2/modules/plan-steps.test
 *
 * The three step owners, tested at the boundary rather than through a game.
 *
 * A `planStepDelta` is a small function with a large blast radius: it decides
 * what a commitment is worth, and every one of its failure modes is silent.
 * Returning a number where it should return `null` moves a step the module
 * does not own; returning `null` where it should return `0` lets the agent
 * discard the card its own plan needs and never notice; matching on a label
 * instead of a tag couples the owner to whatever the proposer called it.
 *
 * Lives beside the modules rather than inside one of them because the property
 * under test spans three: **only the owner moves the step**, and that is not
 * checkable from within any single module.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, CompanyId, GameAction } from '@meccg/shared';
import type { ModuleContext } from '../core/types.js';
import type { Plan, PlanStep } from '../core/plan.js';
import { CARD_STEP, CARRIER_STEP, CHECK_STEP, ROUTE_STEP } from '../core/plan.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { handModule } from './hand/hand.js';
import { charactersModule } from './characters/characters.js';
import { travelModule } from './travel/travel.js';

const COMPANY = 'company-p1-0' as CompanyId;
const OTHER_COMPANY = 'company-p1-1' as CompanyId;
const HAUBERK = 'p1-42' as CardInstanceId;
const OTHER_CARD = 'p1-43' as CardInstanceId;
const THEODEN = 'p1-7' as CardInstanceId;
const GIMLI = 'p1-8' as CardInstanceId;

/** A plan requiring `COMPANY` at Isengard, carrying the given steps. */
function plan(steps: readonly PlanStep[], cardInstanceId = HAUBERK): Plan {
  return {
    id: 'test/plan',
    module: 'resources',
    goal: { label: 'play Hauberk at Isengard', source: 'item', mp: 2, cardInstanceId },
    payoffTsd: 4,
    deadline: 20,
    requirements: [{
      kind: 'company-at-site',
      companyId: COMPANY,
      siteDefinitionId: 'isengard',
      byTurn: 20,
    }],
    steps,
  };
}

function step(tag: string, owner: string, p = 1): PlanStep {
  return { label: `${tag} step`, p, owner, tag };
}

/**
 * A context whose company holds the given untapped characters (plus any
 * `tapped` ones), standing at `siteDefinitionId` when one is given.
 *
 * The real `computeBudget` runs over this, so the untapped set is derived the
 * way the module derives it rather than stubbed — a stub would pass even if
 * `untappedIn` were reading the wrong company.
 */
function context(
  untapped: readonly CardInstanceId[],
  tapped: readonly CardInstanceId[] = [],
  siteDefinitionId?: string,
): ModuleContext {
  const roster = [...untapped, ...tapped];
  const characters = Object.fromEntries(roster.map(id => [id as string, {
    instanceId: id,
    definitionId: 'ch-1',
    status: untapped.includes(id) ? 'untapped' : 'tapped',
    company: COMPANY,
    followers: [],
    items: [],
    effectiveStats: { prowess: 3, body: 6, directInfluence: 1, corruptionPoints: 0 },
  }]));
  return {
    view: {
      turnNumber: 3,
      self: {
        companies: [{
          id: COMPANY,
          characters: roster,
          currentSite: siteDefinitionId
            ? { instanceId: 'site-inst', definitionId: siteDefinitionId, status: 'untapped' }
            : null,
          destinationSite: null,
        }],
        characters,
        hand: [],
        siteDeck: [],
      },
      opponent: {},
      phaseState: { phase: 'organization' },
    } as never,
    cardPool: { 'ch-1': { name: 'A character', cardType: 'hero-character', mind: 2 } } as never,
    legalActions: [],
    tunables: DEFAULT_TUNABLES,
    standing: {} as never,
  };
}

describe('hand owns the card-in-hand step', () => {
  test('discarding the plan\'s card makes it impossible, not merely worse', () => {
    const p = plan([step(CARD_STEP, 'hand')]);
    const action = { type: 'discard-card', cardInstanceId: HAUBERK } as unknown as GameAction;
    expect(handModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBe(0);
  });

  test('discarding a different card leaves the step alone', () => {
    const p = plan([step(CARD_STEP, 'hand')]);
    const action = { type: 'discard-card', cardInstanceId: OTHER_CARD } as unknown as GameAction;
    expect(handModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBeNull();
  });

  test('refuses a step it does not own even when the action is its own', () => {
    // The property that makes contributions addable. `hand` discards, so it
    // would happily answer here — the tag is what stops it.
    const p = plan([step(ROUTE_STEP, 'travel')]);
    const action = { type: 'discard-card', cardInstanceId: HAUBERK } as unknown as GameAction;
    expect(handModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBeNull();
  });

  test('ignores actions that are not discards', () => {
    const p = plan([step(CARD_STEP, 'hand')]);
    const action = { type: 'draw-cards', count: 1 } as unknown as GameAction;
    expect(handModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBeNull();
  });
});

describe('characters owns the carrier step', () => {
  test('splitting the last untapped character away kills the play', () => {
    const p = plan([step(CARRIER_STEP, 'characters')]);
    const action = {
      type: 'split-company', sourceCompanyId: COMPANY, characterId: THEODEN,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN]))).toBe(0);
  });

  test('splitting one of two leaves someone behind, so nothing moves', () => {
    const p = plan([step(CARRIER_STEP, 'characters')]);
    const action = {
      type: 'split-company', sourceCompanyId: COMPANY, characterId: THEODEN,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN, GIMLI])))
      .toBeNull();
  });

  test('an action naming somebody outside the company is not this plan\'s problem', () => {
    const p = plan([step(CARRIER_STEP, 'characters')]);
    const action = {
      type: 'split-company', sourceCompanyId: OTHER_COMPANY, characterId: GIMLI,
    } as unknown as GameAction;
    // GIMLI is not in the plan's company here, so nothing it does can spend
    // the last character who could make the play.
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN]))).toBeNull();
  });

  test('spending the last untapped character costs the commitment, whatever taps him', () => {
    // The measured bottleneck: H2 arrives at a site with nobody left to tap
    // 75.1% of the time. `tapTempoCost` is a flat 0.3 and does not know a
    // commitment exists, so the price of the last tap has to come from the
    // plan it forfeits — and that is true of an influence attempt just as much
    // as of a company split.
    const p = plan([step(CARRIER_STEP, 'characters')]);
    const action = {
      type: 'influence-attempt', characterInstanceId: THEODEN,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN]))).toBe(0);
  });

  test('spending one of two leaves the play possible', () => {
    const p = plan([step(CARRIER_STEP, 'characters')]);
    const action = {
      type: 'influence-attempt', characterInstanceId: THEODEN,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN, GIMLI])))
      .toBeNull();
  });

  test('moving someone into an empty company restores the play', () => {
    const p = plan([step(CARRIER_STEP, 'characters', 0)]);
    const action = {
      type: 'move-to-company',
      sourceCompanyId: OTHER_COMPANY,
      targetCompanyId: COMPANY,
      characterInstanceId: GIMLI,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBe(1);
  });

  test('refuses a step it does not own', () => {
    const p = plan([step(CARD_STEP, 'hand')]);
    const action = {
      type: 'split-company', sourceCompanyId: COMPANY, characterId: THEODEN,
    } as unknown as GameAction;
    expect(charactersModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN]))).toBeNull();
  });
});

describe('travel owns the route step', () => {
  test('refuses the check step, which nothing moves', () => {
    // `factions` owns it and cannot move it either. The point is that a step
    // outside a module's tag set gets `null` rather than a guess.
    const p = plan([step(CHECK_STEP, 'factions', 0.6)]);
    const action = { type: 'plan-movement', companyId: COMPANY } as unknown as GameAction;
    expect(travelModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBeNull();
  });

  test('ignores a movement of some other company', () => {
    const p = plan([step(ROUTE_STEP, 'travel', 0.25)]);
    const action = { type: 'plan-movement', companyId: OTHER_COMPANY } as unknown as GameAction;
    expect(travelModule.planStepDelta?.(action, p, p.steps[0], 0, context([]))).toBeNull();
  });

  test('entering the plan\'s site completes the route when someone can still make the play', () => {
    const p = plan([step(ROUTE_STEP, 'travel', 0.25)]);
    const action = { type: 'enter-site', companyId: COMPANY } as unknown as GameAction;
    expect(travelModule.planStepDelta?.(action, p, p.steps[0], 0, context([THEODEN], [GIMLI], 'isengard'))).toBe(1);
  });

  test('entering with every character tapped completes nothing', () => {
    // Regression: bug report on game mv39kkpr-e3uq7f (stateSeq 1696). The
    // portfolio was committed at the start of the turn, while the company was
    // untapped; after movement/hazard combat tapped both characters, entering
    // Barrow-downs was still credited as completing the plan's route, so H2
    // walked a fully tapped company into the automatic attack with nobody
    // able to tap for the item it went there for.
    const p = plan([step(ROUTE_STEP, 'travel', 0.25)]);
    const action = { type: 'enter-site', companyId: COMPANY } as unknown as GameAction;
    expect(travelModule.planStepDelta?.(action, p, p.steps[0], 0, context([], [THEODEN, GIMLI], 'isengard'))).toBeNull();
  });
});
