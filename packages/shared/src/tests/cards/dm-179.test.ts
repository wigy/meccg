/**
 * @module dm-179.test
 *
 * Card test: Noble Hound (dm-179)
 * Type: hero-resource-ally
 * Stats: prowess 3, body 6, mind 1, MP 1 (ally)
 * Non-unique. Playable at any border-hold.
 *
 * Card text:
 *   "Playable at any tapped or untapped Border-hold [{B}]. In all cases,
 *   Noble Hound must be assigned a strike before any strike can be assigned
 *   to its controlling character. If Noble Hound is tapped or wounded, treat
 *   it as though it were untapped for the purposes of assigning strikes.
 *   Discard Noble Hound to cancel any effect that would take its controlling
 *   character prisoner (does not protect other characters from being taken
 *   prisoner)."
 *
 * Engine Support:
 * | # | Feature                                        | Status          | Notes                                            |
 * |---|------------------------------------------------|-----------------|--------------------------------------------------|
 * | 1 | Playable at border-hold (untapped)             | IMPLEMENTED     | playableAt [{siteType:"border-hold"}]            |
 * | 2 | Playable at TAPPED border-hold                 | IMPLEMENTED     | play-flag: allow-when-site-tapped                |
 * | 3 | Must be assigned strike before controller      | IMPLEMENTED     | play-flag: must-take-strike-before-controller    |
 * | 4 | Tapped/wounded treated as untapped for strikes | IMPLEMENTED     | play-flag: always-available-for-strike           |
 * | 5 | Discard to cancel prisoner effect              | NOT IMPLEMENTED | prisoner mechanic (Rule 8.35) not yet in engine  |
 *
 * Playable: PARTIALLY (prisoner protection not implemented)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  buildSitePhaseState,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH, BREE, DUNNISH_CLAN_HOLD,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { CardStatus, RegionType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, AssignStrikeAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const NOBLE_HOUND = 'dm-179' as CardDefinitionId;

// ─── Helper: build a site-phase state with Noble Hound in hand ───────────────

function buildNHSiteState(opts: { site: CardDefinitionId; siteStatus?: CardStatus }) {
  return buildSitePhaseState({ site: opts.site, hand: [NOBLE_HOUND], siteStatus: opts.siteStatus });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Noble Hound (dm-179)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1 & 2: Playable at border-holds (tapped or untapped) ───────────

  test('Noble Hound IS playable at an untapped border-hold', () => {
    const state = buildNHSiteState({ site: BREE });
    const nobleHoundId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === nobleHoundId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Noble Hound IS playable at a TAPPED border-hold', () => {
    const state = buildNHSiteState({ site: BREE, siteStatus: CardStatus.Tapped });
    const nobleHoundId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === nobleHoundId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Noble Hound IS playable at another border-hold (Dunnish Clan-hold)', () => {
    const state = buildNHSiteState({ site: DUNNISH_CLAN_HOLD });
    const nobleHoundId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === nobleHoundId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Noble Hound is NOT playable at a free-hold (Minas Tirith)', () => {
    const state = buildNHSiteState({ site: MINAS_TIRITH });
    const nobleHoundId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === nobleHoundId);
    expect(playActions).toHaveLength(0);
  });

  test('Noble Hound is NOT playable at a haven (Rivendell)', () => {
    const state = buildNHSiteState({ site: RIVENDELL });
    const nobleHoundId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === nobleHoundId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 3: Noble Hound must be assigned a strike before its controller ──

  test('controlling character cannot be assigned a strike while Noble Hound is unassigned', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const withCombat = makeCancelWindowCombat(withHound, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Aragorn cannot be assigned (Noble Hound shields him)
    expect(assignActions.some(a => a.characterId === aragornId)).toBe(false);
    // Noble Hound CAN be assigned (it's the only legal target)
    const houndId = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();
    expect(assignActions.some(a => a.characterId === houndId)).toBe(true);
  });

  test('controlling character CAN be assigned a strike after Noble Hound has been assigned', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const withCombatBase = makeCancelWindowCombat(withHound, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombatBase, RESOURCE_PLAYER, ARAGORN);
    const houndId = withCombatBase.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();

    // Simulate Noble Hound already assigned
    const withHoundAssigned = {
      ...withCombatBase,
      combat: {
        ...withCombatBase.combat!,
        strikeAssignments: [{ characterId: houndId, excessStrikes: 0, resolved: false }],
      },
    };

    const assignActions = computeLegalActions(withHoundAssigned, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Now Aragorn CAN be assigned
    expect(assignActions.some(a => a.characterId === aragornId)).toBe(true);
  });

  // ─── Rule 4: Tapped/wounded Noble Hound still available for strike ────────

  test('tapped Noble Hound can still be assigned a strike (always-available-for-strike)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const withCombat = makeCancelWindowCombat(withHound, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 1,
    });

    // Tap Noble Hound
    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const tappedHound = { ...aragornData.allies[0], status: CardStatus.Tapped };
    const updatedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [tappedHound] },
    };
    const tappedHoundState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: updatedChars },
        withCombat.players[HAZARD_PLAYER],
      ] as unknown as typeof withCombat.players,
    };

    const houndId = tappedHound.instanceId;
    const assignActions = computeLegalActions(tappedHoundState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Tapped Noble Hound IS still offered as a strike target
    expect(assignActions.some(a => a.characterId === houndId)).toBe(true);
  });

  test('tapped Noble Hound still shields its controller (controller blocked while hound unassigned)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const withCombat = makeCancelWindowCombat(withHound, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    // Tap Noble Hound
    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const tappedHound = { ...aragornData.allies[0], status: CardStatus.Tapped };
    const updatedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [tappedHound] },
    };
    const tappedHoundState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: updatedChars },
        withCombat.players[HAZARD_PLAYER],
      ] as unknown as typeof withCombat.players,
    };

    const assignActions = computeLegalActions(tappedHoundState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Aragorn is still blocked (tapped hound counts as eligible via always-available-for-strike)
    expect(assignActions.some(a => a.characterId === aragornId)).toBe(false);
    // The tapped hound itself IS offered
    expect(assignActions.some(a => a.characterId === tappedHound.instanceId)).toBe(true);
  });

  test('wounded Noble Hound can still be assigned a strike (always-available-for-strike)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const withCombat = makeCancelWindowCombat(withHound, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 1,
    });

    // Wound Noble Hound (Inverted status)
    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const woundedHound = { ...aragornData.allies[0], status: CardStatus.Inverted };
    const updatedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [woundedHound] },
    };
    const woundedHoundState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: updatedChars },
        withCombat.players[HAZARD_PLAYER],
      ] as unknown as typeof withCombat.players,
    };

    const houndId = woundedHound.instanceId;
    const assignActions = computeLegalActions(woundedHoundState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Wounded Noble Hound IS still offered as a strike target
    expect(assignActions.some(a => a.characterId === houndId)).toBe(true);
  });
});
