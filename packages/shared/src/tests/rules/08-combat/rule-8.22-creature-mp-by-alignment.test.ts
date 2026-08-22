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
import { applyRule8_22AfterTrophyDecision } from '../../../engine/combat-finalize.js';

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

  // Regression: hunt-attack (The Hunt dm-143) and long-dark-reach-attack
  // (dm-70) route a defeated creature into the defender's kill pile, but
  // attackSourceCreatureInstanceId returned null for them, so 8.22's
  // starred/alignment routing never ran — a hero/FW defender kept kill-MP for
  // a starred creature (and a minion/Balrog for a non-starred one).
  test('8.22 also routes creatures defeated via hunt-attack and long-dark-reach-attack', () => {
    const SONS_OF_KINGS = 'le-91' as CardDefinitionId; // starred (2*)
    const HOBGOBLINS_DEF = HOBGOBLINS; // non-starred

    // Build a hero defender whose kill pile already holds the defeated creature
    // (the state finalizeCombat produces before 8.22 runs), and apply 8.22.
    const buildAndApply = (
      sourceType: 'hunt-attack' | 'long-dark-reach-attack',
      creatureDef: CardDefinitionId,
      defenderAlignment: Alignment,
    ) => {
      const base = buildTestState({
        phase: Phase.MovementHazard,
        activePlayer: PLAYER_1,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: defenderAlignment, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
          { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [LORIEN] },
        ],
      });
      const creatureInstanceId = mint();
      const companyId = companyIdAt(base, RESOURCE_PLAYER);
      const stateWithKill = {
        ...base,
        players: base.players.map((p, i) =>
          i === RESOURCE_PLAYER
            ? { ...p, killPile: [...p.killPile, { instanceId: creatureInstanceId, definitionId: creatureDef }] }
            : p,
        ) as unknown as typeof base.players,
      };
      const combat: CombatState = {
        attackSource: { type: sourceType, creatureInstanceId } as CombatState['attackSource'],
        companyId,
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 3,
        creatureBody: null,
        creatureRace: Race.Orc,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'resolve-strike',
        assignmentPhase: 'done',
        bodyCheckTarget: null,
        detainment: false,
      };
      return { creatureInstanceId, after: applyRule8_22AfterTrophyDecision(stateWithKill, combat) };
    };

    // Hunt-attack, hero defender, STARRED creature → removed from play (no kill-MP).
    {
      const { creatureInstanceId, after } = buildAndApply('hunt-attack', SONS_OF_KINGS, Alignment.Wizard);
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }
    // Long-dark-reach, minion defender, NON-starred creature → removed from play.
    {
      const { creatureInstanceId, after } = buildAndApply('long-dark-reach-attack', HOBGOBLINS_DEF, Alignment.Ringwraith);
      expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    }
    // Control: hunt-attack, hero defender, NON-starred creature → stays in kill pile.
    {
      const { creatureInstanceId, after } = buildAndApply('hunt-attack', HOBGOBLINS_DEF, Alignment.Wizard);
      expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    }
  });
});
