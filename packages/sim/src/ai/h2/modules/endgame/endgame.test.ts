/**
 * @module ai/h2/modules/endgame/endgame.test
 *
 * Calling the Free Council does not move the score — it stops it moving. So
 * the utility is not a score delta at all: it is the difference between a
 * settled result and the fitted odds of reaching it, which is the one place
 * `W` is used to price certainty rather than change.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { endgameModule } from './endgame.js';

const CALL = { type: 'call-free-council' } as unknown as GameAction;

function contextWith(self: Record<string, number>, opponent: Record<string, number>): ModuleContext {
  const view = {
    self: { id: 'p1', marshallingPoints: testMarshallingPoints(self), hand: [], characters: {}, companies: [], cardsInPlay: [] },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 30,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: {},
    legalActions: [CALL],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

describe('calling', () => {
  test('is worth doing when ahead — it converts likely into certain', () => {
    const context = contextWith({ character: 6, item: 6, faction: 6, ally: 6 }, { character: 2, item: 2, faction: 2, ally: 2 });
    expect(context.standing.tsd).toBeGreaterThan(0);
    const evaluation = endgameModule.evaluate(CALL, context)!;
    expect(evaluation.utility).toBeGreaterThan(0);
    // The score itself does not move, and the module must not pretend it does.
    expect(evaluation.expectedTsd).toBe(0);
  });

  test('is worth avoiding when behind — it settles a loss', () => {
    const context = contextWith({ character: 2, item: 2, faction: 2, ally: 2 }, { character: 6, item: 6, faction: 6, ally: 6 });
    expect(endgameModule.evaluate(CALL, context)!.utility).toBeLessThan(0);
  });

  test('is worth more the less certain the lead was', () => {
    // A narrow lead is worth locking in; a commanding one was nearly certain
    // already, so calling adds little.
    const narrow = endgameModule.evaluate(CALL, contextWith(
      { character: 4, item: 4, faction: 4, ally: 4 }, { character: 3, item: 3, faction: 3, ally: 3 },
    ))!;
    const commanding = endgameModule.evaluate(CALL, contextWith(
      { character: 9, item: 9, faction: 9, ally: 9 }, { character: 1, item: 1, faction: 1, ally: 1 },
    ))!;
    expect(narrow.utility).toBeGreaterThan(commanding.utility);
  });
});

describe('doubling denial', () => {
  test('names the sources riding on the opponent having none', () => {
    const context = contextWith(
      { character: 4, item: 4, faction: 4, ally: 4 },
      { character: 4, item: 4, faction: 4 },
    );
    const text = JSON.stringify(endgameModule.evaluate(CALL, context)!.rationale);
    expect(text).toContain('doubled while the opponent has none');
  });

  test('says so when nothing is riding on denial', () => {
    const context = contextWith(
      { character: 4, item: 4, faction: 4, ally: 4 },
      { character: 4, item: 4, faction: 4, ally: 4 },
    );
    expect(JSON.stringify(endgameModule.evaluate(CALL, context)!.rationale))
      .toContain('nothing is riding on denial');
  });
});

describe('what it admits', () => {
  test('that it has no model of another turn', () => {
    const evaluation = endgameModule.evaluate(CALL, contextWith({ character: 5 }, { character: 3 }))!;
    expect(evaluation.assumptions.some(a => a.includes('no model of what another turn would bring'))).toBe(true);
  });
});
