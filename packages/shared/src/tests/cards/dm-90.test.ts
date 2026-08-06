/**
 * @module dm-90.test
 *
 * Card test: Spells of the Barrow-wights (dm-90)
 * Type: hazard-event (permanent)
 *
 * "Playable on a character facing an Undead strike. If the strike is
 * successful, target character is not harmed and is taken prisoner at a
 * Ruins & Lairs [{R}] or Shadow-hold [{S}]. Character must discard any
 * rings along with his other items. At the start of each of his untap
 * phases, make a body check for that character. Rescue-attack: Undead —
 * 3 strikes with 8 prowess."
 *
 * Engine support:
 *   - play-window { phase: "combat", step: "resolve-strike" }
 *   - play-target with filter { "attack.race": "undead" }
 *   - take-prisoner effect: no wound on strike success; prisoner state
 *     created; rescue site may be ruins-and-lairs or shadow-hold
 *
 * Regression: reported via bug-report (game mshubgh3-safuck, stateSeq 98) —
 * Spells of the Barrow-wights was never offered as a legal action after a
 * Barrow-wight strike resolved, because dm-90's `effects` array was empty.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, CardInstanceId, Race } from '../../index.js';
import type { PlayerState } from '../../index.js';
import {
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, dispatch, viableActions,
  buildTestState, findCharInstanceId, companyIdAt,
  makeShadowMHState,
} from '../test-helpers.js';

const SPELLS_OF_THE_BARROW_WIGHTS = 'dm-90' as CardDefinitionId;
const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId; // shadow-hold

describe('dm-90: Spells of the Barrow-wights', () => {
  beforeEach(() => resetMint());

  test('Not playable on non-Undead attack', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SPELLS_OF_THE_BARROW_WIGHTS], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Orc, // Not Undead
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike' as const,
      assignmentPhase: 'done' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...state, combat, phaseState: makeShadowMHState() };
    const playHazardActions = viableActions(combatState, PLAYER_2, 'play-hazard');
    const spellsActions = playHazardActions.filter(a => {
      const p2State = combatState.players.find(p => p.id === PLAYER_2);
      const handCard = p2State?.hand.find(c => c.instanceId === (a as { cardInstanceId?: CardInstanceId }).cardInstanceId);
      return handCard?.definitionId === SPELLS_OF_THE_BARROW_WIGHTS;
    });
    expect(spellsActions).toHaveLength(0);
  });

  test('Playable on a character facing an Undead strike, with a Ruins & Lairs or Shadow-hold rescue site available', () => {
    function makeState(siteDeck: CardDefinitionId[]) {
      const base = buildTestState({
        phase: Phase.MovementHazard,
        activePlayer: PLAYER_1,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SPELLS_OF_THE_BARROW_WIGHTS], siteDeck },
        ],
      });

      const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
      const companyId = companyIdAt(base, RESOURCE_PLAYER);
      const combat = {
        attackSource: { type: 'creature' as const, instanceId: 'fake-barrow-wight' as CardInstanceId },
        companyId,
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 12,
        creatureBody: null,
        creatureRace: Race.Undead,
        strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
        currentStrikeIndex: 0,
        phase: 'resolve-strike' as const,
        assignmentPhase: 'done' as const,
        bodyCheckTarget: null,
        detainment: false,
      };
      return { ...base, combat, phaseState: makeShadowMHState() };
    }

    const withRuinsAndLairs = makeState([BANDIT_LAIR]);
    const withShadowHold = makeState([THE_UNDER_LEAS]);
    const withoutRescueSite = makeState([RIVENDELL]);

    expect(viableActions(withRuinsAndLairs, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
    expect(viableActions(withShadowHold, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
    expect(viableActions(withoutRescueSite, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('On successful Undead strike: character taken prisoner, not wounded', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Attach Spells of the Barrow-wights to Aragorn's hazards (simulates it being played earlier).
    const hostId = `${PLAYER_2 as string}-host1` as CardInstanceId;
    const withHazard = {
      ...base,
      players: base.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              hazards: [{ instanceId: hostId, definitionId: SPELLS_OF_THE_BARROW_WIGHTS, status: 'Untapped' as const }],
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-barrow-wight' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // Creature guaranteed to win
      creatureBody: null,
      creatureRace: Race.Undead,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike' as const,
      assignmentPhase: 'done' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...withHazard, combat, phaseState: makeShadowMHState(), cheatRollTotal: 2 };
    const resolveActions = viableActions(combatState, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true) ?? resolveActions[0];
    const result = dispatch(combatState, tapAction.action);

    // Character not wounded — taken prisoner instead.
    expect(result.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe('Inverted');
    // Prisoner record created.
    expect(result.hazardHosts).toHaveLength(1);
    expect(result.hazardHosts[0].prisoners).toContain(aragornId);
    expect(result.hazardHosts[0].rescueSiteCard.definitionId).toBe(BANDIT_LAIR);
    // Rescue site removed from hazard player's deck.
    expect(result.players[HAZARD_PLAYER].siteDeck.some(s => s.definitionId === BANDIT_LAIR)).toBe(false);
  });
});
