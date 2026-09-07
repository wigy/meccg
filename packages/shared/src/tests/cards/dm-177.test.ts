/**
 * @module dm-177.test
 *
 * Card test: Lindion the Oronín (dm-177)
 * Type: hero-resource-ally
 * Alignment: wizard
 * Stats: prowess 3, body 9, MP 1 (ally)
 * Unique. Playable at Stone-circle.
 *
 * Card text:
 *   "Unique. Playable at Stone-circle. Tap Lindion the Oronín to cancel an
 *    Animal or Spider attack against his company. Eagle-mounts can be
 *    played on his company regardless of their site or the presence of a
 *    diplomat."
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                             |
 * |---|-------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Unique — only one copy allowed                        | IMPLEMENTED | standard uniqueness check                          |
 * | 2 | Playable at Stone-circle (name-matched)               | IMPLEMENTED | playableAt [{site:"Stone-circle"}]                 |
 * | 3 | Tap to cancel an Animal or Spider attack              | IMPLEMENTED | cancel-attack, cost tap:self, enemy.race $in       |
 * | 4 | Eagle-mounts playable regardless of site/diplomat     | IMPLEMENTED | company.allyNames context + tw-220 filter $or      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  makeCancelWindowCombat,
  makeSitePhase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CancelAttackAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const LINDION = 'dm-177' as CardDefinitionId;
const STONE_CIRCLE = 'tw-427' as CardDefinitionId;
const EAGLE_MOUNTS = 'tw-220' as CardDefinitionId;

describe('Lindion the Oronín (dm-177)', () => {
  beforeEach(() => resetMint());

  // ─── Playable-at: Stone-circle ────────────────────────────────────────────

  test('Lindion IS playable at Stone-circle', () => {
    const rawBase = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: STONE_CIRCLE, characters: [ARAGORN] }], hand: [LINDION], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const base = { ...rawBase, phaseState: makeSitePhase() };
    const lindionInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(base, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === lindionInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Lindion is NOT playable at Lórien (haven)', () => {
    const rawBase = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [LINDION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const base = { ...rawBase, phaseState: makeSitePhase() };
    const lindionInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(base, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === lindionInstanceId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Tap Lindion to cancel an Animal or Spider attack ─────────────────────

  test('cancel-attack IS offered against an Animal attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLindion = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LINDION);
    const withCombat = makeCancelWindowCombat(withLindion, { creatureRace: Race.Animal });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const lindionInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(lindionInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === lindionInstanceId)).toBe(true);
  });

  test('cancel-attack IS offered against a Spider attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLindion = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LINDION);
    const withCombat = makeCancelWindowCombat(withLindion, { creatureRace: Race.Spider });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const lindionInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(lindionInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === lindionInstanceId)).toBe(true);
  });

  test('cancel-attack is NOT offered against an Orc attack (not Animal or Spider)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLindion = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LINDION);
    const withCombat = makeCancelWindowCombat(withLindion, { creatureRace: Race.Orc });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const lindionInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(lindionInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === lindionInstanceId)).toBe(false);
  });

  test('tapped Lindion cannot cancel an Animal attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLindion = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LINDION);
    const withCombat = makeCancelWindowCombat(withLindion, { creatureRace: Race.Animal });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[aragornId];
    const lindionInstanceId = aragornData?.allies[0]?.instanceId;
    expect(lindionInstanceId).toBeDefined();

    const tappedLindion = { ...aragornData.allies[0], status: CardStatus.Tapped };
    const updatedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [tappedLindion] },
    };
    const tappedState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: updatedChars },
        withCombat.players[1],
      ] as unknown as typeof withCombat.players,
    };

    const cancelActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === lindionInstanceId)).toBe(false);
  });

  // ─── Eagle-mounts playable regardless of site/diplomat ───────────────────

  test('Eagle-mounts is NOT playable on a non-diplomat company away from Eagles’ Eyrie without Lindion', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('Eagle-mounts IS playable on a non-diplomat company away from Eagles’ Eyrie when Lindion is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withLindion = attachAllyToChar(base, RESOURCE_PLAYER, LEGOLAS, LINDION);
    const cardInstance = withLindion.players[RESOURCE_PLAYER].hand[0].instanceId;
    const legolasInstance = findCharInstanceId(withLindion, RESOURCE_PLAYER, LEGOLAS);

    const playActions = viableActions(withLindion, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string });
    const eagleMounts = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(eagleMounts).toBeDefined();
    expect(eagleMounts?.targetScoutInstanceId).toBe(legolasInstance);
  });
});
