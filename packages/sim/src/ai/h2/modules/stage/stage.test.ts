/**
 * @module ai/h2/modules/stage/stage.test
 *
 * The module encodes one policy — every playable stage resource is played —
 * as a valuation rather than a rule, so the tests are about the three edges of
 * that encoding: a stage play must price above `pass` even when its
 * marshalling points are worth nothing (the stage-point term is what carries
 * it), a *non*-stage permanent event must be declined rather than scored
 * (ownership is the alignment, not the action type), and a voluntary
 * `discard-stage-resource` must price below `pass` (the policy's other half —
 * the module keeps the action covered precisely so nothing else discards on a
 * unitless weight).
 */

import { describe, expect, test } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext, Rationale } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { stageModule } from './stage.js';

/** A bare stage resource: 1 stage point, no marshalling points. */
const PLAIN_STAGE = 'st-plain';
/** A payoff-shaped stage resource: 3 stage points and 5 misc MP. */
const RICH_STAGE = 'st-rich';
/** A non-stage permanent event sharing the same action type. */
const NON_STAGE = 'ev-fellowship';

const POOL = {
  [PLAIN_STAGE]: {
    cardType: 'minion-resource-event',
    alignment: 'stage',
    name: 'Gatherer of Loyalties',
    eventType: 'permanent',
    effects: [{ type: 'stage-points', value: 1 }],
  },
  [RICH_STAGE]: {
    cardType: 'minion-resource-event',
    alignment: 'stage',
    name: 'Await the Onset',
    eventType: 'permanent',
    marshallingPoints: 5,
    marshallingCategory: 'misc',
    effects: [{ type: 'stage-points', value: 3 }],
  },
  [NON_STAGE]: {
    cardType: 'hero-resource-event',
    name: 'Fellowship',
    eventType: 'permanent',
    effects: [{ type: 'stat-modifier', stat: 'prowess', value: 1 }],
  },
} as unknown as ModuleContext['cardPool'];

/** A Fallen-wizard mid-game: both stage cards in hand, one on the table. */
function context(): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      stagePoints: 5,
      hand: [
        { instanceId: 'c-plain', definitionId: PLAIN_STAGE },
        { instanceId: 'c-rich', definitionId: RICH_STAGE },
        { instanceId: 'c-fellowship', definitionId: NON_STAGE },
      ],
      playDeck: [],
      sideboard: [],
      discardPile: [],
      characters: {},
      companies: [],
      cardsInPlay: [
        { instanceId: 'c-played', definitionId: RICH_STAGE },
      ],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: {
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      characters: {},
      cardsInPlay: [],
      companies: [],
      hand: [],
      discardPile: [],
      killPile: [],
      outOfPlayPile: [],
    },
    turnNumber: 8,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

/** Playing a permanent event from hand during organization. */
const play = (cardInstanceId: string): GameAction =>
  ({ type: 'play-permanent-event', player: 'p1', cardInstanceId } as unknown as GameAction);

/** Voluntarily discarding an in-play stage resource (MEWH). */
const discard = (cardInstanceId: string): GameAction =>
  ({ type: 'discard-stage-resource', player: 'p1', cardInstanceId } as unknown as GameAction);

/** Every tunable name cited anywhere in a rationale tree. */
function citedTunables(rationale: Rationale): string[] {
  const names: string[] = [];
  if (rationale.tunable) names.push(rationale.tunable);
  for (const child of rationale.children ?? []) names.push(...citedTunables(child));
  return names;
}

describe('stage: playing a stage resource', () => {
  test('a stage card with no marshalling points still prices above pass', () => {
    // The whole point of the stage-point term: without it this card is worth
    // exactly zero and ties with doing nothing forever.
    const evaluation = stageModule.evaluate(play('c-plain'), context());
    expect(evaluation).not.toBeNull();
    expect(evaluation!.utility).toBeGreaterThan(0);
  });

  test('marshalling points rank the richer stage card above the bare one', () => {
    const ctx = context();
    const plain = stageModule.evaluate(play('c-plain'), ctx)!;
    const rich = stageModule.evaluate(play('c-rich'), ctx)!;
    expect(rich.utility).toBeGreaterThan(plain.utility);
  });

  test('the stage-point price is cited by its tunable name', () => {
    // The no-anonymous-constants invariant: the hand-chosen number must name
    // the Tunables field it came from, so `explain` and the sweep can find it.
    const evaluation = stageModule.evaluate(play('c-plain'), context())!;
    expect(citedTunables(evaluation.rationale)).toContain('stagePointTsd');
  });
});

describe('stage: ownership is the alignment, not the action type', () => {
  test('a non-stage permanent event is declined, not scored', () => {
    // Declining leaves the action exactly as uncovered as it was before this
    // module existed; scoring it would be an invented number.
    expect(stageModule.evaluate(play('c-fellowship'), context())).toBeNull();
  });

  test('an unknown card instance is declined', () => {
    expect(stageModule.evaluate(play('c-missing'), context())).toBeNull();
  });
});

describe('stage: voluntary discard', () => {
  test('discarding an in-play stage resource prices below pass', () => {
    // The policy's other half: the discard stays covered — so no fallback can
    // take it on a unitless weight — and prices negative, so it is never
    // preferred to doing nothing.
    const evaluation = stageModule.evaluate(discard('c-played'), context());
    expect(evaluation).not.toBeNull();
    expect(evaluation!.utility).toBeLessThan(0);
  });
});
