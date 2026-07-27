/**
 * @module td-102.test
 *
 * Card test: Bow of Dragon-horn (td-102)
 * Type: hero-resource-item (major weapon), unique, 2 corruption, 2 MPs.
 * Keywords: hoard.
 *
 * Card text:
 *   "Unique. Hoard item. Warrior only: tap bow to reduce the number of
 *    strikes from one hazard creature attack not keyed to a site by one
 *    (to a minimum of one)."
 *
 * Engine Support:
 * | # | Feature                                                | Status      | Notes                                                     |
 * |---|--------------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Playable only at hoard sites                           | IMPLEMENTED | item-play-site filter on site.keywords.$includes "hoard"  |
 * | 2 | Warrior-only gate on activation                        | IMPLEMENTED | when: bearer.skills $includes warrior                     |
 * | 3 | Only activatable against creature attacks (not at site)| IMPLEMENTED | when: attack.source === "creature"                        |
 * | 4 | Tap bow → strikesTotal reduced by 1, minimum 1         | IMPLEMENTED | strikesModifier: -1 clamped to min 1 in handleModifyAttack|
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId,
  attachItemToChar,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN, FRODO,
  ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus, SiteType, Race } from '../../index.js';
import type { CardDefinitionId, ModifyAttackAction } from '../../index.js';

const BOW_OF_DRAGON_HORN = 'td-102' as CardDefinitionId;

describe('Bow of Dragon-horn (td-102)', () => {
  beforeEach(() => resetMint());

  // ─── Positive: warrior bearer during creature attack, reduces strikes ────

  test('modify-attack IS available when a warrior bears the bow against a creature attack', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 3,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const theodenId = findCharInstanceId(combatState, RESOURCE_PLAYER, THEODEN);
    const act = modifyActions[0].action as ModifyAttackAction;
    expect(act.characterInstanceId).toBe(theodenId);
  });

  test('executing modify-attack taps the bow and reduces strikesTotal by 1', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 3,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const after = dispatch(combatState, modifyActions[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');

    // Strikes reduced by 1: 3 → 2.
    expect(after.combat!.strikesTotal).toBe(2);
    // Prowess unchanged.
    expect(after.combat!.strikeProwess).toBe(6);

    // Item is tapped, still on Théoden.
    const theodenId = findCharInstanceId(after, RESOURCE_PLAYER, THEODEN);
    const theoden = after.players[RESOURCE_PLAYER].characters[theodenId];
    expect(theoden.items).toHaveLength(1);
    expect(theoden.items[0].definitionId).toBe(BOW_OF_DRAGON_HORN);
    expect(theoden.items[0].status).toBe(CardStatus.Tapped);
  });

  // ─── Positive: minimum 1 strike enforced ────────────────────────────────

  test('strikesTotal is clamped to 1 when attack already has only 1 strike', () => {
    let base = buildTestState({
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
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 1,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const after = dispatch(combatState, modifyActions[0].action);

    // Strikes clamped at minimum 1.
    expect(after.combat!.strikesTotal).toBe(1);
  });

  // ─── Negative: not available against automatic attacks ───────────────────

  test('modify-attack is NOT available against automatic attacks (keyed to site)', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Negative: not available against on-guard creatures (keyed to site) ─

  test('modify-attack is NOT available against on-guard-creature attacks', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackSourceType: 'on-guard-creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Negative: not available against hazard creatures keyed to a site ───

  test('modify-attack is NOT available against a hazard creature keyed to a site type', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    // Creature with site-type keying only (no regional keying) → keyed to a site
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      attackSiteKeyingTypes: [SiteType.ShadowHold],
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Negative: non-warrior bearer cannot activate ────────────────────────

  test('modify-attack is NOT available when bearer lacks the warrior skill', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [FRODO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, FRODO, BOW_OF_DRAGON_HORN);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Negative: already-tapped bow cannot activate ───────────────────────

  test('modify-attack is NOT available when the bow is already tapped', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BOW_OF_DRAGON_HORN);

    const theodenId = findCharInstanceId(base, RESOURCE_PLAYER, THEODEN);
    const tappedChar = {
      ...base.players[RESOURCE_PLAYER].characters[theodenId],
    };
    tappedChar.items = tappedChar.items.map(it =>
      it.definitionId === BOW_OF_DRAGON_HORN ? { ...it, status: CardStatus.Tapped } : it,
    );
    base = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: {
            ...base.players[RESOURCE_PLAYER].characters,
            [theodenId as string]: tappedChar,
          },
        },
        base.players[1],
      ] as unknown as typeof base.players,
    };

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });
});
