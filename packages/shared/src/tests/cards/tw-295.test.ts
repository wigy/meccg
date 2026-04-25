/**
 * @module tw-295.test
 *
 * Card test: Orcrist (tw-295)
 * Type: hero-resource-item (greater, weapon)
 * Effects: 2
 *
 * "Unique. Weapon. +3 to prowess to a maximum of 9
 *  (+4 prowess to a maximum of 10 against Orcs)."
 *
 * This tests:
 * 1. stat-modifier: prowess +3 (max 9) — unconditional
 * 2. stat-modifier: prowess +4 (max 10) in combat vs orc — overrides orcrist-prowess
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, GLORFINDEL_II,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, getCharacter,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, ResolveStrikeAction } from '../../index.js';
import { computeLegalActions, RegionType, SiteType } from '../../index.js';

const ORCRIST = 'tw-295' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Orcrist (tw-295)', () => {
  beforeEach(() => resetMint());

  test('prowess +3 capped at 9 for Aragorn (base 6)', () => {
    // Aragorn base prowess 6. Orcrist adds +3 → 9, exactly at cap.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ORCRIST] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(9);
  });

  test('prowess +3 uncapped for Frodo (base 1)', () => {
    // Frodo base prowess 1. Orcrist adds +3 → 4, well below cap of 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [ORCRIST] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.prowess).toBe(1);
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(4);
  });

  test('prowess capped at 9 for Glorfindel II (base 8)', () => {
    // Glorfindel II base prowess 8. Orcrist adds +3 → 11, capped at 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GLORFINDEL_II, items: [ORCRIST] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(baseDef.prowess).toBe(8);
    expect(getCharacter(s, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(9);
  });

  test('orc bonus raises need from 7 to 6 for Frodo vs Orc-lieutenant', () => {
    // Frodo base prowess 1.
    // Base Orcrist: +3 → 4 (max 9, no cap); untapped combat = 4-3=1 vs OrcLieutenant 7 → need=max(2,7-1+1)=7
    // Orc Orcrist: +4 → 5 (max 10, no cap); untapped combat = 5-3=2 vs OrcLieutenant 7 → need=max(2,7-2+1)=6
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: FRODO, items: [ORCRIST] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
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

    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterCombat = playCreatureHazardAndResolve(
      gameState, PLAYER_2, orcId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    const frodoId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, FRODO);
    const assigned = dispatch(afterCombat, { type: 'assign-strike', player: PLAYER_1, characterId: frodoId });
    const passed = dispatch(assigned, { type: 'pass', player: PLAYER_1 });

    const actions = computeLegalActions(passed, PLAYER_1);
    const resolveStrikes = actions.filter(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveStrikes.length).toBeGreaterThan(0);

    // Untapped: prowess 5 (orc bonus) - 3 = 2 vs creature 7 → need 6
    // Without orc bonus: prowess 4 - 3 = 1 vs 7 → need would be 7
    const untapAction = resolveStrikes.find(
      a => 'tapToFight' in a.action && !actionAs<ResolveStrikeAction>(a.action).tapToFight,
    );
    expect(untapAction).toBeDefined();
    expect(actionAs<ResolveStrikeAction>(untapAction!.action).need).toBe(6);
  });

  test('body is not modified by Orcrist', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ORCRIST] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(baseDef.body);
  });
});
