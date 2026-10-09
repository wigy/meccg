/**
 * @module tw-242.test
 *
 * Card test: Ford (tw-242)
 * Type: hero-resource-event (short, ranger-only)
 * Effects: 3
 *   1. play-window: organization / end-of-org
 *   2. play-target character, DSL filter { ranger skill, untapped },
 *      cost { tap: character }, requiredSkill ranger
 *   3. on-event self-enters-play → add-constraint
 *      no-creatures-keyed-to-region-type, regionType:wilderness, scope:turn,
 *      target:scout-company
 *
 * Text:
 *   "Ranger only. Playable at the end of the organization phase on an untapped
 *    ranger. Tap the ranger. No hazard creatures may be keyed by type to
 *    Wilderness [{w}] against the ranger's company this turn."
 *
 * Every keying match of a hazard creature is its own `play-hazard` action
 * (`keyedBy`), so the constraint drops exactly the plays keyed by region type
 * Wilderness; the same creature keyed by site type, by region name, or to a
 * different region type in the path survives.
 *
 * Engine Support:
 * | # | Rule (card text)                                        | Status      | Mechanism                                          |
 * |---|---------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Playable at the end of the organization phase           | IMPLEMENTED | play-window organization/end-of-org                |
 * | 2 | Ranger only; on an untapped ranger                      | IMPLEMENTED | play-target filter ranger/untapped                 |
 * | 3 | Tap the ranger                                          | IMPLEMENTED | play-target cost { tap: character }                |
 * | 4 | No creatures keyed by type to Wilderness vs. company    | IMPLEMENTED | no-creatures-keyed-to-region-type (keyedBy filter) |
 * | 5 | (site / region-name / other region-type keying allowed) | IMPLEMENTED | only region-type:wilderness plays are dropped      |
 * | 6 | this turn                                               | IMPLEMENTED | scope:turn, swept at turn-end                      |
 *
 * Playable: YES
 * Certified: 2026-10-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  CAVE_DRAKE, TOM_TUMA,
  RIVENDELL, LORIEN, MINAS_TIRITH, BANDIT_LAIR,
  makeMHState, mint,
  viableActions, dispatch,
  companyIdAt, charIdAt, findHandCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { CardStatus, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction, GameState } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const FORD = 'tw-242' as CardDefinitionId;
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId; // {w}{w} or Mirkwood region names
const WARGS = 'tw-109' as CardDefinitionId;        // one of border / wilderness / shadow

/**
 * Org-phase state: Aragorn (ranger) and Bilbo (non-ranger) at Rivendell,
 * moving to Bandit Lair. The opponent holds the hazard creatures.
 */
function orgState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO], destinationSite: BANDIT_LAIR }],
        hand: [FORD],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [CAVE_DRAKE, TOM_TUMA, GIANT_SPIDERS, WARGS],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** Ford plays offered for the given state. */
function fordPlays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, FORD);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

/**
 * M/H state for the company reaching Bandit Lair (Ruins & Lairs) through two
 * Wildernesses (one in Heart of Mirkwood) and a Shadow-land.
 */
function atBanditLair(state: GameState): GameState {
  return {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhovanion', 'Heart of Mirkwood', 'Brown Lands'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Bandit Lair',
    }),
  };
}

/** Keying keys (`method:value`) offered for one hazard card against the company. */
function keyings(state: GameState, defId: CardDefinitionId): Set<string> {
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const cardId = findHandCardId(state, HAZARD_PLAYER, defId);
  return new Set(
    viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === cardId)
      .map(a => `${a.keyedBy?.method}:${a.keyedBy?.value}`),
  );
}

/** The Ford constraint payload, as the reducer creates it. */
function fordConstraint(companyId: ReturnType<typeof companyIdAt>) {
  return {
    source: mint(),
    sourceDefinitionId: FORD,
    scope: { kind: 'turn' as const },
    target: { kind: 'company' as const, companyId },
    kind: { type: 'no-creatures-keyed-to-region-type' as const, regionType: RegionType.Wilderness },
  };
}

describe('Ford (tw-242)', () => {
  beforeEach(() => resetMint());

  test('playable in the organization phase only on the untapped ranger', () => {
    const base = orgState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const plays = fordPlays(base);
    // Exactly one action — targeting Aragorn (ranger), never Bilbo.
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(aragornId);
  });

  test('not playable when the ranger is tapped', () => {
    const base = orgState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const aragorn = base.players[0].characters[aragornId];
    const tapped = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: { ...base.players[0].characters, [aragornId]: { ...aragorn, status: CardStatus.Tapped } },
        },
        base.players[1],
      ] as typeof base.players,
    };
    expect(fordPlays(tapped)).toHaveLength(0);
  });

  test('playing it taps the ranger and adds the Wilderness keying constraint to his company', () => {
    const base = orgState();
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FORD);
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const bilboId = charIdAt(base, RESOURCE_PLAYER, 0, 1);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: aragornId,
    });

    expect(next.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(next.players[0].characters[bilboId].status).toBe(CardStatus.Untapped);
    expect(next.players[0].hand.some(c => c.instanceId === cardId)).toBe(false);

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'no-creatures-keyed-to-region-type', regionType: RegionType.Wilderness });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('Wilderness-keyed creature plays are blocked; site, region-name and other region-type keyings survive', () => {
    const base = atBanditLair(orgState());
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Baseline: every keying route is offered.
    expect(keyings(base, TOM_TUMA)).toEqual(new Set(['region-type:wilderness']));
    expect(keyings(base, CAVE_DRAKE)).toEqual(new Set(['region-type:wilderness', 'site-type:ruins-and-lairs']));
    expect(keyings(base, GIANT_SPIDERS)).toEqual(new Set(['region-type:wilderness', 'region-name:Heart of Mirkwood']));
    expect(keyings(base, WARGS)).toEqual(new Set(['region-type:wilderness', 'region-type:shadow']));

    const constrained = addConstraint(base, fordConstraint(companyId));

    // Wilderness-only creature: no play left at all.
    expect(keyings(constrained, TOM_TUMA).size).toBe(0);
    // Only the by-type Wilderness keying is removed.
    expect(keyings(constrained, CAVE_DRAKE)).toEqual(new Set(['site-type:ruins-and-lairs']));
    expect(keyings(constrained, GIANT_SPIDERS)).toEqual(new Set(['region-name:Heart of Mirkwood']));
    expect(keyings(constrained, WARGS)).toEqual(new Set(['region-type:shadow']));
  });

  test('the constraint only protects the ranger\'s company', () => {
    const base = atBanditLair(orgState());
    const otherCompanyId = companyIdAt(base, HAZARD_PLAYER);
    const constrained = addConstraint(base, fordConstraint(otherCompanyId));
    expect(keyings(constrained, TOM_TUMA)).toEqual(new Set(['region-type:wilderness']));
  });

  test('the constraint clears at turn-end (this turn)', () => {
    const base = orgState();
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FORD);
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: aragornId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
