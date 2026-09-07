/**
 * @module td-66.test
 *
 * Card test: Sea Serpent (td-66)
 * Type: hazard-creature (Drake), non-unique
 *
 * Text:
 *   "Drake. Two strikes."
 *
 * Base stats: strikes 2, prowess 14, body 6, kill MP 2, race drake.
 *
 * keyedTo (canonical playable "{c}" from data/cards.json TD-66): one
 * Coastal-sea region in the resolved site path.
 *
 * REGRESSION: the imported `keyedTo` read `regionTypes: ["coastal-sea"]`,
 * which is not a valid `RegionType` (the enum value is `"coastal"` —
 * `regionTypesMatch` in reducer-utils.ts keys strictly off the enum). The
 * mismatched string meant the creature could never be keyed to any real
 * site path and was unplayable. Fixed to `regionTypes: ["coastal"]`, the
 * same fix already applied to Fell Turtle (tw-34) and Pirates (le-88).
 *
 * Effects: none — "Drake" and "Two strikes" are carried by the base `race`
 * and `strikes` fields, handled structurally by the engine.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const SEA_SERPENT = 'td-66' as CardDefinitionId;

const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

function makeCoastalMHState(overrides?: Parameters<typeof makeMHState>[0]) {
  return makeMHState({
    resolvedSitePath: [RegionType.Coastal],
    resolvedSitePathNames: ['Bay of Belfalas'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

function baseStateWithHazardInHand() {
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
        hand: [SEA_SERPENT],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Sea Serpent (td-66)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 14, drake, body 6 ─────────────────

  test('attack uses 2 strikes at prowess 14 with drake race and body 6', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };
    const serpentId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, serpentId, companyId, COASTAL_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(14);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBe(6);
  });

  // ─── Keying: requires a Coastal-sea region in the site path ───────────────

  test('NOT playable on a pure wilderness path (no Coastal-sea in path)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('playable on a path containing one Coastal-sea region', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });

  test('playable on a mixed path that includes a Coastal-sea region', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeCoastalMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal],
        resolvedSitePathNames: ['Rhudaur', 'Bay of Belfalas'],
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });
});
