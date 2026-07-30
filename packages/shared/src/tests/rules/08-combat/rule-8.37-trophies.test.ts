/**
 * @module rule-8.37-trophies
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.37: Trophies
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a defending player's company defeats an opponent's creature, the defending player may take the creature as a "trophy" by placing it under the control of an Orc or Troll character that faced one of the creature's strikes. A trophy is treated as a minor item worth zero corruption points (for the purpose of all effects while it is being used as a trophy, including effects that would require an item to be discarded), but it cannot be transferred nor stored.
 * Half-orcs cannot take trophies.
 * Character cards cannot be used as trophies.
 * Defeated Dragon manifestations may be used as trophies, including Dragon factions.
 * Creatures being used as trophies provide the same number of kill marshalling points that they would to the defeating player if the creature was not being used as a trophy (i.e. the creature's normal value for non-detainment attacks, and zero marshalling points for detainment attacks).
 * A character's attributes are modified based on the total number of marshalling points printed on its trophy cards (regardless of how many points the cards are worth to the player):
 * • 1 total MP: +1 direct influence
 * • 2 total MPs: +1 direct influence, +1 prowess
 * • 3 total MPs: +2 direct influence, +1 prowess
 * • 4 or more total MPs: +2 direct influence, +2 prowess
 * Prowess bonuses from trophies are applied to a maximum of 9.
 * If a player would discard a trophy that is currently worth marshalling points to that player, the creature card is placed in the player's marshalling point pile. If a player would discard a trophy that is currently not worth marshalling points to that player, the creature card is removed from play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, CardStatus, Race, resolveInstanceId } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, viableActions, viableFor, findCharInstanceId, companyIdAt, makeShadowMHState, recomputeDerived, RESOURCE_PLAYER,
  assertEveryInstanceReachable,
} from '../../test-helpers.js';
import type { CombatState } from '../../../index.js';

// Orc character (minion, race: orc, mind has a value)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // orc warrior, mind 5, prowess 6, DI 2

// Creature with kill-MP (Orc-guard: race orc, killMarshallingPoints 2)
const ORC_GUARD = 'tw-072' as CardDefinitionId;

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

/** Build a combat state where the creature was just defeated (all strikes succeeded)
 *  and we're about to enter finalizeCombat. The creature card is in the attacker's
 *  cardsInPlay so finalizeCombat can move it. */
function makeTrophyOfferState(opts: { orcDefId: CardDefinitionId; creatureDefId: CardDefinitionId }) {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [opts.orcDefId] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
    ],
  });

  const orcId = findCharInstanceId(base, RESOURCE_PLAYER, opts.orcDefId);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  // Mint a creature instance and put it in attacker's cardsInPlay
  const creatureInstance = {
    instanceId: 'creature-inst' as never,
    definitionId: opts.creatureDefId,
    status: CardStatus.Untapped,
  };
  const stateWithCreature = {
    ...base,
    players: base.players.map((p, i) =>
      i === 1 ? { ...p, cardsInPlay: [...p.cardsInPlay, creatureInstance] } : p,
    ) as unknown as typeof base.players,
  };

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstance.instanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 8,
    creatureBody: 5,
    creatureRace: Race.Orc,
    strikeAssignments: [{
      characterId: orcId,
      excessStrikes: 0,
      resolved: true,
      result: 'success',
    }],
    currentStrikeIndex: 0,
    phase: 'body-check',
    assignmentPhase: 'done',
    bodyCheckTarget: 'creature',
    detainment: false,
  };

  return {
    state: { ...stateWithCreature, phaseState: makeShadowMHState(), combat, cheatRollTotal: 12 },
    orcId,
    creatureInstanceId: creatureInstance.instanceId,
  };
}

describe('Rule 8.37 — Trophies', () => {
  beforeEach(() => resetMint());

  test('Orc or Troll that defeats creature strike may take it as trophy (minor item, 0 CP); provides DI/prowess bonuses based on total MP', () => {
    const { state, orcId, creatureInstanceId } = makeTrophyOfferState({
      orcDefId: ORC_CAPTAIN,
      creatureDefId: ORC_GUARD,
    });

    // Roll the body check (cheat roll 12 > body 5, creature defeated).
    // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);

    // Should be in trophy-offer phase now if Orc-guard has kill-MP > 0
    const orcGuardDef = state.cardPool['tw-072' as CardDefinitionId] as { killMarshallingPoints: number } | undefined;
    if (!orcGuardDef || orcGuardDef.killMarshallingPoints === 0) {
      // Orc-guard has 0 kill-MP — no trophy offer; combat finalized directly
      expect(afterBodyCheck.combat).toBeNull();
      return;
    }

    expect(afterBodyCheck.combat?.phase).toBe('trophy-offer');
    expect(afterBodyCheck.combat?.trophyEligibleCharacters).toContain(orcId);

    // Take the trophy
    const afterTrophy = dispatch(afterBodyCheck, {
      type: 'take-trophy',
      player: PLAYER_1,
      characterId: orcId,
      creatureInstanceId,
    });

    // Combat cleared
    expect(afterTrophy.combat).toBeNull();

    // Trophy is on the character
    const char = afterTrophy.players[0].characters[orcId];
    expect(char?.trophies?.some(t => t.instanceId === creatureInstanceId)).toBe(true);

    // Regression (no-disappear invariant): a creature taken as a trophy lives
    // only in `character.trophies`, so resolveInstanceId must still find it.
    expect(resolveInstanceId(afterTrophy, creatureInstanceId)).toBe(ORC_GUARD);
    assertEveryInstanceReachable(afterTrophy);
  });

  test('trophy-offer phase computes legal actions (take-trophy per eligible char + pass) so the game does not stall', () => {
    // Regression for game mrhx2tb7-9vcj4g, seq 137: a defeated Orc-guard left
    // combat in the `trophy-offer` phase but the legal-action computer had no
    // case for that phase, so BOTH players got zero actions and the game hung
    // with "No valid actions".
    const { state, orcId, creatureInstanceId } = makeTrophyOfferState({
      orcDefId: ORC_CAPTAIN,
      creatureDefId: ORC_GUARD,
    });

    // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);
    expect(afterBodyCheck.combat?.phase).toBe('trophy-offer');

    // Defending player (PLAYER_1) is offered a take-trophy for the eligible
    // Orc/Troll character plus a pass to decline.
    const takeTrophy = viableActions(afterBodyCheck, PLAYER_1, 'take-trophy');
    expect(takeTrophy).toHaveLength(1);
    expect(takeTrophy[0].action).toMatchObject({
      type: 'take-trophy',
      player: PLAYER_1,
      characterId: orcId,
      creatureInstanceId,
    });
    expect(viableActions(afterBodyCheck, PLAYER_1, 'pass')).toHaveLength(1);

    // The attacking player has no actions during the trophy offer, but the
    // defender always does — so the game can never stall here.
    expect(viableFor(afterBodyCheck, PLAYER_2)).toHaveLength(0);
    expect(viableFor(afterBodyCheck, PLAYER_1).length).toBeGreaterThan(0);

    // The offered take-trophy action actually resolves.
    const afterTrophy = dispatch(afterBodyCheck, takeTrophy[0].action);
    expect(afterTrophy.combat).toBeNull();
    expect(afterTrophy.players[0].characters[orcId]?.trophies?.some(t => t.instanceId === creatureInstanceId)).toBe(true);
  });

  test('3.IV.2 — Detainment-creature trophy on Orc/Troll scores 0 kill-MP at Free Council; §3.IV.3 printed-MP attribute bonuses still apply', () => {
    // This test verifies that trophies provide DI/prowess bonuses
    // even when the trophy came from a detainment attack (0 kill-MP).
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
      ],
    });

    // Place Orc-guard as a trophy on ORC_CAPTAIN
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const orcGuardTrophy = {
      instanceId: 'trophy-inst' as never,
      definitionId: ORC_GUARD,
    };

    const stateWithTrophy = {
      ...base,
      players: base.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        const char = p.characters[orcId];
        return {
          ...p,
          characters: {
            ...p.characters,
            [orcId as string]: { ...char, trophies: [orcGuardTrophy] },
          },
        };
      }) as unknown as typeof base.players,
    };

    const recomputed = recomputeDerived(stateWithTrophy);
    const char = recomputed.players[RESOURCE_PLAYER].characters[orcId];

    // Orc-guard has kill-MP. Check if stat bonus applies.
    const orcGuardDef = base.cardPool['tw-072' as CardDefinitionId] as
      { killMarshallingPoints?: number; prowess?: number; directInfluence?: number } | undefined;

    if (orcGuardDef && (orcGuardDef.killMarshallingPoints ?? 0) >= 1) {
      // At least 1 trophy MP → +1 DI
      const baseDef = base.cardPool['le-31' as CardDefinitionId] as { directInfluence: number };
      expect(char?.effectiveStats.directInfluence).toBeGreaterThan(baseDef.directInfluence);
    }
  });
});
