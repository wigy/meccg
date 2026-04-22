/**
 * @module le-50.test
 *
 * Card test: Adûnaphel the Ringwraith (le-50)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 8, body 10, direct influence 4, mind null.
 * Skills: warrior, scout, diplomat. Homesite: Urlurtsu Nurn.
 *
 * Card text:
 *   "Unique. Manifestation of Adûnaphel. Can use spirit-magic. +2 direct
 *    influence in Heralded Lord mode. -2 prowess in Fell Rider mode. As
 *    your Ringwraith, if at a Darkhaven, she may tap to cancel one
 *    hazard creature attack not played at a site against any one of
 *    your companies."
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                                   |
 * |---|------------------------------------------------------|-------------|---------------------------------------------------------|
 * | 1 | Darkhaven tap → cancel M/H creature attack           | IMPLEMENTED | `cancel-attack` + `bearer.atHaven` + `attack.source`    |
 * | 2 | "Not played at a site" discriminator                 | IMPLEMENTED | `attack.source === "creature"` (M/H-played only)        |
 * | 3 | Can use spirit-magic                                 | FLAVOR      | No certified spirit-magic consumer today; deferred      |
 * | 4 | +2 DI in Heralded Lord mode / -2 prow in Fell Rider  | FLAVOR      | Stat changes live on le-190 / le-183 resource cards     |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId,
  expectInDiscardPile,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type {
  CardDefinitionId,
  CancelAttackAction,
} from '../../index.js';

const ADUNAPHEL_RW = 'le-50' as CardDefinitionId;

// Companion minion character for company-composition tests (non-avatar).
const LUITPRAND = 'le-23' as CardDefinitionId;

// Darkhaven (siteType: haven, ringwraith alignment).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// Second Darkhaven to pad the site deck.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Non-haven minion site.
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId;
// Hero site to give the opposing player a legal position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

// Hazard creature used to drive the cancel-attack combat tests.
const ORC_PATROL = 'tw-074' as CardDefinitionId;

describe('Adûnaphel the Ringwraith (le-50)', () => {
  beforeEach(() => resetMint());

  // ─── Positive: Darkhaven + M/H creature attack ─────────────────────────────

  test('cancel-attack IS available when Adûnaphel is untapped at a Darkhaven and an M/H creature attacks her company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const adunaphelId = findCharInstanceId(combatState, RESOURCE_PLAYER, ADUNAPHEL_RW);
    const cancel = cancelActions[0].action as CancelAttackAction;
    expect(cancel.cardInstanceId).toBe(adunaphelId);
  });

  test('executing the cancel-attack taps Adûnaphel and discards the attacking creature', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat fully canceled.
    expect(after.combat).toBeNull();

    // Adûnaphel is now tapped.
    const adunaphelId = findCharInstanceId(after, RESOURCE_PLAYER, ADUNAPHEL_RW);
    const adunaphel = after.players[RESOURCE_PLAYER].characters[adunaphelId as string];
    expect(adunaphel.status).toBe(CardStatus.Tapped);

    // The hazard creature lands in the hazard player's discard pile.
    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
  });

  // ─── Negative: the three gates of the `when` clause ────────────────────────

  test('cancel-attack is NOT available against an on-guard-creature attack (played at a site)', () => {
    // The "not played at a site" clause excludes on-guard reveals: those are
    // played at the site during the site phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'on-guard-creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available against an automatic-attack (played at a site)', () => {
    // Site automatic attacks are played at the site itself.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'automatic-attack',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available when Adûnaphel is at a non-Darkhaven site', () => {
    // Goblin-gate is a minion shadow-hold (not a haven). `bearer.atHaven`
    // resolves false → `when` clause fails.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE_MINION, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available when Adûnaphel is already tapped', () => {
    // The tap-self cost cannot be paid if she is not untapped.
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const adunaphelId = findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL_RW);
    const adunaphelChar = base.players[RESOURCE_PLAYER].characters[adunaphelId as string];
    const updatedChars = {
      ...base.players[RESOURCE_PLAYER].characters,
      [adunaphelId as string]: { ...adunaphelChar, status: CardStatus.Tapped },
    };
    base = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], characters: updatedChars },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  // ─── Company composition regression ────────────────────────────────────────

  test('cancel-attack IS available when Adûnaphel is in a larger company at a Darkhaven', () => {
    // Regression: no size gate on her ability — unlike Stinker (which gates
    // on size < 3), Adûnaphel's text has no company-size restriction. Verify
    // she still offers the cancel with a companion alongside her.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL_RW, LUITPRAND] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
    });

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
  });
});
