/**
 * @module tw-232.test
 *
 * Card test: Fair Sailing (tw-232)
 * Type: hero-resource-event (short)
 * Effects: 4
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: true }
 *   3. on-event self-enters-play → add-constraint `hazard-limit-region-count`,
 *      scope:turn, target:target-company, regionType:coastal, value:-1, floor:2
 *   4. duplication-limit scope:company, max:1
 *
 * Text:
 *   "Playable at the end of the organization phase if target company plays a
 *    new site card. The hazard limit for the target company decreases by one
 *    for every Coastal Sea [{c}] in its site path (to a minimum of two).
 *    Cannot be duplicated on the same company."
 *
 * "Plays a new site card" (CoE 2.II.7) is any company that has declared
 * movement this organization phase — the same `company.moving` play-target
 * filter used by Master of Esgaroth (td-135) and Down Down to Goblin-town
 * (le-181). Since starter vs. region movement is only chosen later, when the
 * path is declared during the company's own movement/hazard phase, the card
 * leaves behind a turn-scoped `hazard-limit-region-count` constraint rather
 * than computing the reduction at play time. `snapshotHazardLimit`
 * (mh-steps.ts) reads it once the company's site path is actually resolved,
 * counting Coastal Sea occurrences and applying the same floor semantics as
 * `hazard-limit-environment` ("to a minimum of two" never raises a limit
 * already at or below the floor).
 *
 * Engine Support:
 * | # | Rule (card text)                                          | Status      | Mechanism                                                  |
 * |---|------------------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Playable at the end of the organization phase               | IMPLEMENTED | play-window phase:organization step:end-of-org               |
 * | 2 | if target company plays a new site card                     | IMPLEMENTED | play-target company filter { company.moving: true }          |
 * | 3 | hazard limit decreases by one per Coastal Sea in site path   | IMPLEMENTED | hazard-limit-region-count constraint, read in snapshotHazardLimit |
 * | 4 | to a minimum of two                                          | IMPLEMENTED | floor semantics mirroring hazard-limit-environment            |
 * | 5 | Cannot be duplicated on the same company                     | IMPLEMENTED | duplication-limit scope:company, checked against active-constraint markers |
 *
 * Playable: YES
 * Certified: 2026-08-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch, Phase,
  makeMHState, viableActions,
  companyIdAt, findHandCardId, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import {
  Alignment, RegionType, ARAGORN, LEGOLAS, GIMLI, FRODO, LORIEN, RIVENDELL, MORIA,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayShortEventAction,
} from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const FAIR_SAILING = 'tw-232' as CardDefinitionId;

/**
 * Organization-phase state: the hero company sits at Rivendell with the
 * given characters and, when `dest` is given, has declared movement to it
 * (making it a "moving company").
 */
function orgState(characters: readonly CardDefinitionId[], dest?: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [...characters], ...(dest ? { destinationSite: dest } : {}) }],
        hand: [FAIR_SAILING],
        siteDeck: [MORIA],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
}

/** Play Fair Sailing on the given company during the organization phase. */
function playOn(state: GameState, companyId: ReturnType<typeof companyIdAt>): GameState {
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, FAIR_SAILING),
    targetCompanyId: companyId,
  });
}

/**
 * Build a movement/hazard-phase state stopped at `set-hazard-limit` for a
 * single company of `characterCount` characters (base limit
 * `max(characterCount, 2)`) whose resolved site path is `path`, with the
 * `hazard-limit-region-count` constraint (as installed by Fair Sailing)
 * already active on it. Dispatching `pass` snapshots the real hazard limit
 * through the production `snapshotHazardLimit` code path.
 */
function hazardLimitAfterFairSailing(
  characterCount: number,
  path: readonly RegionType[],
): number {
  const characters = [ARAGORN, LEGOLAS, GIMLI, FRODO].slice(0, characterCount);
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters, destinationSite: MORIA }],
        hand: [],
        siteDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const constrained = addConstraint(state, {
    source: mint(),
    sourceDefinitionId: FAIR_SAILING,
    scope: { kind: 'turn' },
    target: { kind: 'company', companyId },
    kind: { type: 'hazard-limit-region-count', regionType: RegionType.Coastal, perCount: -1, floor: 2 },
  });
  const ready: GameState = {
    ...constrained,
    phaseState: makeMHState({
      step: 'set-hazard-limit',
      activeCompanyIndex: 0,
      resolvedSitePath: [...path],
      destinationSiteType: null,
      destinationSiteName: null,
    }),
  };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
}

describe('Fair Sailing (tw-232)', () => {
  beforeEach(() => resetMint());

  test('playable at the end of the organization phase on a moving company', () => {
    const base = orgState([ARAGORN], MORIA);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FAIR_SAILING);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable on a company that is not moving', () => {
    const base = orgState([ARAGORN]); // no declared destination
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FAIR_SAILING);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('the organization-phase play window is enforced — not playable during the M/H phase', () => {
    const base = orgState([ARAGORN], MORIA);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FAIR_SAILING);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const plays = viableActions(inMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it installs the hazard-limit-region-count constraint on the company', () => {
    const base = orgState([ARAGORN], MORIA);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FAIR_SAILING);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playOn(base, companyId);

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({
      type: 'hazard-limit-region-count',
      regionType: RegionType.Coastal,
      perCount: -1,
      floor: 2,
    });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    // The spent short event leaves hand for the discard pile.
    expect(next.players[0].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(next.players[0].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  test('cannot be duplicated on the same company — a company already bearing the constraint is excluded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA },
            { site: LORIEN, characters: [GIMLI], destinationSite: MORIA },
          ],
          hand: [FAIR_SAILING],
          siteDeck: [MORIA],
          playDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
          playDeck: [],
        },
      ],
    });
    const [companyA, companyB] = state.players[0].companies;
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FAIR_SAILING);

    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: FAIR_SAILING,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: companyA.id },
      kind: { type: 'hazard-limit-region-count', regionType: RegionType.Coastal, perCount: -1, floor: 2 },
    });

    const plays = viableActions(constrained, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyB.id);
  });

  test('hazard limit decreases by one per Coastal Sea in the resolved site path', () => {
    // Company of 4 → base limit 4. One Coastal Sea → 4 - 1 = 3.
    expect(hazardLimitAfterFairSailing(4, [RegionType.Wilderness, RegionType.Coastal])).toBe(3);
  });

  test('hazard limit is floored at a minimum of two, not reduced further', () => {
    // Company of 3 → base limit 3. Two Coastal Seas would be 3 - 2 = 1, but
    // the floor holds it at 2.
    expect(hazardLimitAfterFairSailing(3, [RegionType.Coastal, RegionType.Coastal])).toBe(2);
  });

  test('a limit already at or below the floor is left unchanged', () => {
    // Company of 1 → base limit max(1, 2) = 2, already at the floor. Even a
    // path with Coastal Seas leaves it at 2, never raising it.
    expect(hazardLimitAfterFairSailing(1, [RegionType.Coastal, RegionType.Coastal, RegionType.Coastal])).toBe(2);
  });

  test('no reduction when the site path has no Coastal Sea', () => {
    expect(hazardLimitAfterFairSailing(4, [RegionType.Wilderness, RegionType.Free])).toBe(4);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = orgState([ARAGORN], MORIA);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const played = playOn(base, companyId);
    expect(played.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(played, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
