/**
 * @module rule-8.22-creature-mp-by-alignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.22: Creature MP by Player Alignment
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] When a Wizard player defeats a creature with a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [MINION] When a Ringwraith player defeats a creature without a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [FALLEN-WIZARD] When a Fallen-wizard player defeats a creature with a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [BALROG] When a Balrog player defeats a creature without a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, Alignment, CardStatus, Race } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  makeDetainmentStrikeState, executeAction,
  ARAGORN, BARROW_WIGHT, HOBGOBLINS,
  LORIEN, RIVENDELL,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  findCharInstanceId, companyIdAt, makeShadowMHState, mint,
} from '../../test-helpers.js';
import type { CombatState } from '../../../index.js';

// Sons of Kings: starred (mp=2*), race=dúnedain — worth MP only to minion players
const SONS_OF_KINGS = 'le-91' as CardDefinitionId;

// Minion character (ORC_CAPTAIN) and minion site
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Build a combat state where a minion (ringwraith) player is defending against a creature.
 * Uses ARAGORN (Dúnedain, not Orc/Troll) as the character to avoid triggering trophy-offer. */
function makeMinionDefenderState(creatureDefId: CardDefinitionId) {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ORC_CAPTAIN] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
  });

  const characterId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  const creatureInstanceId = mint();
  const stateWithCreature = {
    ...base,
    players: base.players.map((p, i) =>
      i === HAZARD_PLAYER
        ? { ...p, cardsInPlay: [...p.cardsInPlay, { instanceId: creatureInstanceId, definitionId: creatureDefId, status: CardStatus.Untapped }] }
        : p,
    ) as unknown as typeof base.players,
  };

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 3,
    creatureBody: null,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };

  return {
    state: { ...stateWithCreature, phaseState: makeShadowMHState(), combat },
    characterId,
    creatureInstanceId,
  };
}

describe('Rule 8.22 — Creature MP by Player Alignment', () => {
  beforeEach(() => resetMint());

  test('Hero/FW: creatures with * removed from play instead of MP pile; Minion/Balrog: creatures without * removed', () => {
    // Case 1: Hero player (PLAYER_1) defeats a NON-starred creature (Barrow-wight).
    // Expected: creature goes to kill pile (hero earns kill MP).
    {
      const { state, creatureInstanceId } = makeDetainmentStrikeState({
        detainment: false,
        strikeProwess: 3,
        creatureInPlay: BARROW_WIGHT,
      });
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

      expect(after.combat).toBeNull();
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }

    // Case 2: Hero player (PLAYER_1) defeats a STARRED creature (Sons of Kings, mp=2*).
    // Expected: creature removed from play (hero does NOT earn kill MP).
    {
      const { state, creatureInstanceId } = makeDetainmentStrikeState({
        detainment: false,
        strikeProwess: 3,
        creatureInPlay: SONS_OF_KINGS,
      });
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

      expect(after.combat).toBeNull();
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }

    // Case 3: Minion player (PLAYER_1, ringwraith) defeats a STARRED creature (Sons of Kings, mp=2*).
    // Expected: creature goes to kill pile (minion earns kill MP from starred creatures).
    {
      const { state, creatureInstanceId } = makeMinionDefenderState(SONS_OF_KINGS);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

      expect(after.combat).toBeNull();
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }

    // Case 4: Minion player (PLAYER_1, ringwraith) defeats a NON-starred creature (Hobgoblins).
    // Expected: creature removed from play (minion does NOT earn kill MP from non-starred creatures).
    {
      const { state, creatureInstanceId } = makeMinionDefenderState(HOBGOBLINS);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

      expect(after.combat).toBeNull();
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }
  });
});
