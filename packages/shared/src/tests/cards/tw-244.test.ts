/**
 * @module tw-244.test
 *
 * Card test: Glamdring (tw-244)
 * Type: hero-resource-item (major, weapon)
 * Effects: 2
 *
 * "Unique. Weapon. +3 to prowess to a maximum of 8
 *  (a maximum of 9 against Orcs)."
 *
 * This tests:
 * 1. stat-modifier: prowess +3 (max 8) — unconditional
 * 2. stat-modifier: prowess +3 (max 9) in combat vs orc — overrides glamdring-prowess
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, FRODO, GLORFINDEL_II,
  GLAMDRING, ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve, runCreatureCombat,
} from '../test-helpers.js';
import type { CharacterCard } from '../../index.js';
import { computeLegalActions, RegionType, SiteType } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Glamdring (tw-244)', () => {
  beforeEach(() => resetMint());

  test('prowess +3 capped at 8 for Aragorn (base 6)', () => {
    // Aragorn base prowess 6. Glamdring adds +3 → 9, capped at 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Dispatch pass to trigger recomputeDerived with DSL effects
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(s.players[0].characters[aragornId as string].effectiveStats.prowess).toBe(8);
  });

  test('prowess +3 uncapped for Frodo (base 1)', () => {
    // Frodo base prowess 1. Glamdring adds +3 → 4, below cap of 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const frodoId = findCharInstanceId(s, 0, FRODO);
    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.prowess).toBe(1);
    expect(s.players[0].characters[frodoId as string].effectiveStats.prowess).toBe(4);
  });

  test('prowess capped at 8 for Glorfindel II (base 8)', () => {
    // Glorfindel II base prowess 8. Glamdring adds +3 → 11, capped at 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GLORFINDEL_II, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const glorfinId = findCharInstanceId(s, 0, GLORFINDEL_II);
    const baseDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(baseDef.prowess).toBe(8);
    expect(s.players[0].characters[glorfinId as string].effectiveStats.prowess).toBe(8);
  });

  test('prowess capped at 9 (not 8) against Orcs', () => {
    // Aragorn base prowess 6. Glamdring adds +3 → 9 vs orcs (normally capped at 8).
    // Orc-lieutenant: 1 strike, prowess 7.
    // With prowess 9 (vs orc), untapped: 9-3=6 vs 7 → need max(2, 7-6+1)=2
    // Without orc bonus (prowess 8), untapped: 8-3=5 vs 7 → need max(2, 7-5+1)=3
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const afterCombat = playCreatureHazardAndResolve(
      gameState, PLAYER_2, orcId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    // Assign the single strike to Aragorn
    const aragornId = findCharInstanceId(afterCombat, 0, ARAGORN);
    const assigned = reduce(afterCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(assigned.error).toBeUndefined();
    // Defender passes → all strikes assigned, transitions to resolve
    const passed = reduce(assigned.state, { type: 'pass', player: PLAYER_1 });
    expect(passed.error).toBeUndefined();

    // Now in resolve-strike phase
    const actions = computeLegalActions(passed.state, PLAYER_1);
    const resolveStrikes = actions.filter(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveStrikes.length).toBeGreaterThan(0);

    // Untapped variant: prowess 9 (vs orc) - 3 = 6 vs creature 7 → need 2
    // If orc bonus were missing: prowess 8 - 3 = 5 vs 7 → need would be 3
    const untapAction = resolveStrikes.find(
      a => 'tapToFight' in a.action && !(a.action as { tapToFight: boolean }).tapToFight,
    );
    expect(untapAction).toBeDefined();
    expect((untapAction!.action as { need: number }).need).toBe(2);
  });

  test('body is not modified by Glamdring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(s.players[0].characters[aragornId as string].effectiveStats.body).toBe(baseDef.body);
  });
});
