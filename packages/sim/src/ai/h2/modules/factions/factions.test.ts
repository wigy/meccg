/**
 * @module ai/h2/modules/factions/factions.test
 *
 * The case this module exists for: a faction whose source is already at the
 * half-total cap is worth nothing however well it rolls, and attempting it
 * costs a tap and a card. H1 scores the same faction at `marshallingPoints *
 * 20` and spends the turn.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { factionsModule } from './factions.js';

const FACTION = 'tw-faction';
const HERO = 'tw-hero';

const POOL = {
  [FACTION]: { name: 'Riders of Rohan', cardType: 'hero-resource-faction', marshallingPoints: 3 },
  [HERO]: { name: 'Aragorn', cardType: 'hero-character', mind: 4 },
} as unknown as Readonly<Record<string, CardDefinition>>;

const ATTEMPT = {
  type: 'influence-attempt',
  factionInstanceId: 'faction-1',
  influencingCharacterId: 'hero-1',
  need: 7,
} as unknown as GameAction;

/** A context whose standing gives faction points the stated marginal value. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>, action = ATTEMPT): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints(self),
      hand: [{ instanceId: 'faction-1', definitionId: FACTION }],
      characters: {
        'hero-1': {
          instanceId: 'hero-1',
          definitionId: HERO,
          status: CardStatus.Untapped,
          items: [], allies: [], hazards: [], followers: [],
          effectiveStats: { prowess: 5, body: 7, directInfluence: 4, corruptionPoints: 0 },
        },
      },
      companies: [{ id: 'company', characters: ['hero-1'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 4,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [action],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

/** A standing where faction points are ordinary: every source is comparable. */
const ORDINARY = { character: 3, item: 3, faction: 3, ally: 3 };
/** A standing where the faction source is pinned at the half-total cap. */
const CAPPED = { character: 2, item: 2, faction: 6, ally: 2 };

describe('the dice', () => {
  test('take the published target rather than recomputing the influence stack', () => {
    // `legal-actions/site.ts` folds free direct influence and every modifier
    // into `need`, so a need of 7 is 21 of 36 and nothing here restates why.
    const evaluation = factionsModule.evaluate(ATTEMPT, contextWith(ORDINARY, ORDINARY))!;
    const success = evaluation.outcomes.find(o => o.label.includes('influenced'))!;
    expect(success.p).toBeCloseTo(21 / 36, 12);
  });

  test('treat an automatic influence as certain', () => {
    const automatic = { ...ATTEMPT, need: 0 } as unknown as GameAction;
    const evaluation = factionsModule.evaluate(automatic, contextWith(ORDINARY, ORDINARY, automatic))!;
    expect(evaluation.outcomes).toHaveLength(1);
    expect(evaluation.outcomes[0].p).toBe(1);
  });

  test('always produce a distribution summing to 1', () => {
    for (const need of [2, 5, 7, 10, 12]) {
      const action = { ...ATTEMPT, need } as unknown as GameAction;
      const evaluation = factionsModule.evaluate(action, contextWith(ORDINARY, ORDINARY, action))!;
      expect(evaluation.outcomes.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 12);
    }
  });
});

describe('what the points are worth', () => {
  test('an ordinary faction point is worth attempting', () => {
    const context = contextWith(ORDINARY, ORDINARY);
    expect(context.standing.marginal.faction).toBeGreaterThan(0);
    expect(factionsModule.evaluate(ATTEMPT, context)!.utility).toBeGreaterThan(0);
  });

  test('a capped faction source makes the attempt worthless, and the module declines it', () => {
    // This is the case H1 cannot represent: it scores the faction at
    // `marshallingPoints * 20` and spends a turn and a card on points that
    // the diversity cap will remove again.
    const context = contextWith(CAPPED, ORDINARY);
    expect(context.standing.marginal.faction).toBe(0);
    const evaluation = factionsModule.evaluate(ATTEMPT, context)!;
    const success = evaluation.outcomes.find(o => o.label.includes('influenced'))!;
    // Even the winning branch is negative: it costs a tap and gains nothing.
    expect(success.dtsd).toBeLessThan(0);
    expect(evaluation.utility).toBeLessThan(0);
  });

  test('the failing branch is worse than the succeeding one by the gain plus the card', () => {
    const context = contextWith(ORDINARY, ORDINARY);
    const evaluation = factionsModule.evaluate(ATTEMPT, context)!;
    const success = evaluation.outcomes.find(o => o.label.includes('influenced'))!;
    const failure = evaluation.outcomes.find(o => o.label.includes('fails'))!;
    // Both branches pay the tap; only the failure also loses the card.
    expect(success.dtsd - failure.dtsd).toBeCloseTo(
      (context.standing.tsdAfter({ faction: 3 }) - context.standing.tsd)
      + DEFAULT_TUNABLES.provisionalCardPrice,
      12,
    );
  });
});

describe('explanations', () => {
  test('name the constants and report the marginal value that decided it', () => {
    const evaluation = factionsModule.evaluate(ATTEMPT, contextWith(CAPPED, ORDINARY))!;
    const named = collectTunables(evaluation.rationale);
    expect(named.has('tapTempoCost')).toBe(true);
    expect(named.has('provisionalCardPrice')).toBe(true);
    expect(JSON.stringify(evaluation.rationale)).toContain('half-total cap');
  });

  test('declare that the opponent is assumed to play nothing into the check', () => {
    const evaluation = factionsModule.evaluate(ATTEMPT, contextWith(ORDINARY, ORDINARY))!;
    expect(evaluation.assumptions.some(a => a.includes('cancelling hazard'))).toBe(true);
  });
});
