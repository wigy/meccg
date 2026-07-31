/**
 * @module tw-308.test
 *
 * Card test: Quickbeam (tw-308) — alternate-art printing of tw-307
 * Type: hero-resource-ally
 * Stats: prowess 6, body 9, mind 3, MP 2 (ally)
 * Unique. Playable at Wellinghall.
 *
 * Card text:
 *   "Unique. Playable at Wellinghall. May not be attacked by automatic-attacks
 *    or hazards keyed to his site."
 *
 * Engine Support:
 * | # | Feature                                               | Status      | Notes                                                          |
 * |---|-------------------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | Unique — only one copy allowed                        | IMPLEMENTED | standard uniqueness check                                      |
 * | 2 | Playable at Wellinghall (name-matched)                | IMPLEMENTED | playableAt [{site:"Wellinghall"}]                              |
 * | 3 | Immune to auto-attacks (attack source = auto-attack)  | IMPLEMENTED | play-flag: no-attack-site-keyed, unconditional for auto-attacks |
 * | 4 | Immune to site-type-keyed creature hazards            | IMPLEMENTED | play-flag: no-attack-site-keyed + attackSiteKeyingTypes check  |
 * | 5 | NOT immune to region-only creature hazards            | IMPLEMENTED | no-attack-site-keyed only triggers when site types match       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  makeSitePhase,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  WELLINGHALL, BANDIT_LAIR, RIVENDELL, LORIEN, MOUNT_DOOM,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, AssignStrikeAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { CombatState } from '../../index.js';

const QUICKBEAM = 'tw-308' as CardDefinitionId;

describe('Quickbeam (tw-308)', () => {
  beforeEach(() => resetMint());

  // ─── Playable-at: Wellinghall ─────────────────────────────────────────────

  test('Quickbeam IS playable at Wellinghall', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [QUICKBEAM], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const quickbeamInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === quickbeamInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Quickbeam is NOT playable at Rivendell (wrong site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [QUICKBEAM], siteDeck: [WELLINGHALL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const quickbeamInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === quickbeamInstanceId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Immunity to automatic-attacks ────────────────────────────────────────

  test('Quickbeam is NOT offered as a defender strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withQuickbeam = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, QUICKBEAM);
    const withCombat = makeCancelWindowCombat(withQuickbeam, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const quickbeamInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(quickbeamInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === quickbeamInstanceId)).toBe(false);
  });

  test('Quickbeam is NOT offered as an attacker strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withQuickbeam = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, QUICKBEAM);
    const withDefenderCombat = makeCancelWindowCombat(withQuickbeam, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withDefenderCombat, RESOURCE_PLAYER, ARAGORN);
    const quickbeamInstanceId = withDefenderCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(quickbeamInstanceId).toBeDefined();

    const combat: CombatState = {
      ...withDefenderCombat.combat!,
      strikeAssignments: [
        { characterId: aragornId, excessStrikes: 0, resolved: false },
      ],
      assignmentPhase: 'attacker',
    };
    const attackerState = { ...withDefenderCombat, combat };

    const assignActions = computeLegalActions(attackerState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === quickbeamInstanceId)).toBe(false);
  });

  // ─── Immunity to site-type-keyed hazard creatures ─────────────────────────

  test('Quickbeam is NOT offered as a strike target when creature is site-type-keyed to current site', () => {
    // Company at Bandit Lair (ruins-and-lairs); creature keyed to ruins-and-lairs.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withQuickbeam = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, QUICKBEAM);
    const withCombat = makeCancelWindowCombat(withQuickbeam, {
      attackSiteKeyingTypes: [SiteType.RuinsAndLairs],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const quickbeamInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(quickbeamInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === quickbeamInstanceId)).toBe(false);
  });

  test('Quickbeam IS offered as a strike target when creature has only region-type keying (no site-type keying)', () => {
    // Creature keyed to wilderness only — no site-type overlap — Quickbeam not immune.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withQuickbeam = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, QUICKBEAM);
    const withCombat = makeCancelWindowCombat(withQuickbeam, {
      attackSiteKeyingTypes: [],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const quickbeamInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(quickbeamInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === quickbeamInstanceId)).toBe(true);
  });

  test('Quickbeam is NOT immune when site-keying does not match the company site type', () => {
    // Creature keyed to shadow-hold, but company is at ruins-and-lairs — no match.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withQuickbeam = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, QUICKBEAM);
    const withCombat = makeCancelWindowCombat(withQuickbeam, {
      attackSiteKeyingTypes: [SiteType.ShadowHold],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const quickbeamInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(quickbeamInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === quickbeamInstanceId)).toBe(true);
  });
});
