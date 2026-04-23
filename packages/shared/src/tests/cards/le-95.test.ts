/**
 * @module le-95.test
 *
 * Card test: True Fire-drake (le-95)
 * Type: hazard-creature (drake)
 *
 * Text:
 *   "Drake. Two strikes. Only two Wildernesses [{w}] in site path are
 *    required if Doors of Night is in play."
 *
 * Base stats: strikes 2, prowess 13, body —, kill MP 1.
 *
 * keyedTo:
 * | # | Entry                                       | When                        | Notes                    |
 * |---|---------------------------------------------|-----------------------------|--------------------------|
 * | 1 | regionTypes: [wilderness, wilderness, wild] | always                      | base keying ({w}{w}{w})  |
 * | 2 | regionTypes: [wilderness, wilderness]       | Doors of Night in play      | alt keying ({w}{w})      |
 *
 * No `effects` — the card has no stat/combat modifiers, only baseline
 * strikes and prowess (handled structurally by the engine) and the
 * Doors-of-Night-gated keying softening.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeDoubleWildernessMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const TRUE_FIRE_DRAKE = 'le-95' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

function makeTripleWildernessMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
}

function baseStateWithHazardInHand(cardsInPlay?: Array<{ instanceId: CardInstanceId; definitionId: CardDefinitionId; status: CardStatus }>) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [TRUE_FIRE_DRAKE],
        siteDeck: [RIVENDELL],
        cardsInPlay: cardsInPlay ?? [],
      },
    ],
  });
}

function donInPlay() {
  return {
    instanceId: 'don-1' as CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };
}

describe('True Fire-drake (le-95)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 13 ────────────────────────────────

  test('attack uses 2 strikes at prowess 13 via wilderness keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeTripleWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(13);
  });

  // ─── Keying: base cost is three wildernesses without Doors of Night ───────

  test('NOT playable on a single-wilderness path (base cost is {w}{w}{w})', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a two-wilderness path without Doors of Night', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('playable on a three-wilderness path (base {w}{w}{w}) without Doors of Night', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeTripleWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  // ─── Doors of Night softens the cost to {w}{w} ────────────────────────────

  test('playable on a two-wilderness path when Doors of Night is in play', () => {
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('still NOT playable on a single-wilderness path even with Doors of Night', () => {
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a pure shadow path regardless of Doors of Night', () => {
    const state = baseStateWithHazardInHand([donInPlay()]);
    const mhShadowOnly = makeMHState({
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul', 'Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mhShadowOnly };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
