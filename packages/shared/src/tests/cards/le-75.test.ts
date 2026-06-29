/**
 * @module le-75.test
 *
 * Card test: Giant Spiders (le-75)
 * Type: hazard-creature
 * Race: Spiders. Two strikes at prowess 10.
 *
 * Card text:
 *   "Spiders. Two strikes. If the body check for a non-Wizard, non-Ringwraith
 *    character wounded by Giant Spiders equals his body, the character is
 *    discarded. May also be played keyed to Heart of Mirkwood, Southern
 *    Mirkwood, Western Mirkwood, and Woodland Realm; and may also be played at
 *    Ruins & Lairs [{R}], Shadow-holds [{S}], and Dark-holds [{D}] in these
 *    regions."
 *
 * Keying (canonical playable: {w}{w}):
 *   - Base: two wildernesses {w}{w} in the site path
 *   - Alt: named regions Heart of Mirkwood, Southern Mirkwood, Western Mirkwood,
 *     Woodland Realm (covers R&L/Shadow-hold/Dark-hold in those regions too)
 *
 * Engine support:
 * | # | Feature                                      | Status      | Notes                                          |
 * |---|----------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Two strikes, prowess 10                      | IMPLEMENTED | structural data                                |
 * | 2 | body check = body → discard non-Wiz/non-RW  | IMPLEMENTED | on-event: character-body-check-equals-body     |
 * | 3 | Keying: {w}{w} double-wilderness             | IMPLEMENTED | regionTypes: [wilderness, wilderness]          |
 * | 4 | Keying: named Mirkwood regions               | IMPLEMENTED | regionNames in keyedTo                         |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeDoubleWildernessMHState, makeMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve,
  executeAction, dispatch,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInPile,
  expectCharNotInPlay,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const GIANT_SPIDERS = 'le-75' as CardDefinitionId;
const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

function setupSpidersCombat(characters: CardDefinitionId[] = [ARAGORN, LEGOLAS]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT_SPIDERS], siteDeck: [RIVENDELL] },
    ],
  });
  const ready = { ...state, phaseState: makeDoubleWildernessMHState() };
  const spidersId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, spidersId, companyId, DOUBLE_WILDERNESS_KEYING);
}

describe('Giant Spiders (le-75)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ───────────────────────────────────────────────────────────────

  test('playable keyed to double-wilderness path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT_SPIDERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeDoubleWildernessMHState() };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spidersId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(a => a.viable)).toBe(true);
  });

  test('NOT playable on single-wilderness path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT_SPIDERS], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spidersId && a.viable);
    expect(viable).toHaveLength(0);
  });

  test('playable keyed to named Mirkwood region in path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT_SPIDERS], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Heart of Mirkwood'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...state, phaseState: mhState };
    const spidersId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spidersId && a.viable);
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Combat initiates ─────────────────────────────────────────────────────

  test('combat initiates with 2 strikes and prowess 10', () => {
    const afterChain = setupSpidersCombat();
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  // ─── Body check equals body → character discarded ─────────────────────────

  test('body check equals body — non-wizard character is discarded to discard pile', () => {
    // Aragorn: prowess 6, body 9. Giant Spiders prowess 10.
    // Strike roll 2: 2+(6-10)=−2 < 0 → wounded. Body check roll 9 = body 9 → discarded.
    const afterChain = setupSpidersCombat();
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2); // Aragorn wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 9); // roll 9 = body 9 → discarded

    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();

    expectCharNotInPlay(s, RESOURCE_PLAYER, aragornId);
    expectInPile(s, RESOURCE_PLAYER, 'discardPile', aragornId);
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  test('body check exceeds body — character is eliminated to out-of-play pile (standard rule)', () => {
    // Roll 10 > body 9 → Aragorn eliminated (standard rule unaffected by Giant Spiders effect)
    const afterChain = setupSpidersCombat();
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 10); // 10 > 9 → eliminated
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();

    expectCharNotInPlay(s, RESOURCE_PLAYER, aragornId);
    expectInPile(s, RESOURCE_PLAYER, 'outOfPlayPile', aragornId);
    expect(s.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  test('body check less than body — character survives as wounded', () => {
    // Roll 8 < body 9 → Aragorn survives wounded
    const afterChain = setupSpidersCombat();
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 8); // 8 < 9 → survives
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();

    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(s.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === aragornId)).toBeUndefined();
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  // ─── Wizard exclusion ─────────────────────────────────────────────────────

  test('body check equals body — Wizard character is NOT discarded (excluded by card text)', () => {
    // Gandalf: race wizard, body 9. Roll 9 = body 9 → must NOT trigger discard.
    const afterChain = setupSpidersCombat([GANDALF, LEGOLAS]);
    const gandalfId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GANDALF);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: gandalfId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2); // Gandalf wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 9); // equals body — but excluded for Wizard
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();

    expect(s.players[RESOURCE_PLAYER].characters[gandalfId]).toBeDefined();
    expect(s.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === gandalfId)).toBeUndefined();
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === gandalfId)).toBeUndefined();
  });
});
