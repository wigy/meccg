/**
 * @module dm-58.test
 *
 * Card test: Flies and Spiders (dm-58)
 * Type: hazard-event (permanent)
 *
 * "Playable on a character facing a Spider attack. If the strike is
 * successful, target character is not harmed and is taken prisoner at a
 * Ruins & Lairs. During his untap phase, make a body check for that
 * character modified by +1. If not eliminated, his player then makes a
 * roll adding his body. If the result is greater than 15, the character
 * is automatically rescued into his own company located at the rescue site.
 * Rescue-attack: Spiders — 3 strikes with 9 prowess."
 *
 * Engine support:
 *   - play-window { phase: "combat", step: "resolve-strike" }
 *   - play-target with filter { "attack.race": "Spider" }
 *   - take-prisoner effect: no wound on strike success; prisoner state created
 *   - rescue site drawn from hazard player's location deck (ruins-and-lairs)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, CardInstanceId } from '../../index.js';
import type { PlayerState } from '../../index.js';
import {
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  buildTestState, findCharInstanceId, companyIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, dispatch, viableActions,
  makeShadowMHState,
} from '../test-helpers.js';

const FLIES_AND_SPIDERS = 'dm-58' as CardDefinitionId;

describe('dm-58: Flies and Spiders', () => {
  beforeEach(() => resetMint());

  test('Not playable on non-Spider attack', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FLIES_AND_SPIDERS], siteDeck: [BANDIT_LAIR] },
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
      creatureRace: 'Orc', // Not a Spider
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike' as const,
      assignmentPhase: 'done' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...state, combat, phaseState: makeShadowMHState() };
    const playHazardActions = viableActions(combatState, PLAYER_2, 'play-hazard');
    const fliesActions = playHazardActions.filter(a => {
      const p2State = combatState.players.find(p => p.id === PLAYER_2);
      const handCard = p2State?.hand.find(c => c.instanceId === (a as { cardInstanceId?: CardInstanceId }).cardInstanceId);
      return handCard?.definitionId === FLIES_AND_SPIDERS;
    });
    expect(fliesActions).toHaveLength(0);
  });

  test('Playable only if valid ruins-and-lairs rescue site is in hazard location deck', () => {
    // Build two states: one with Bandit Lair (ruins-and-lairs) in site deck, one without.
    function makeState(withRescueSite: boolean) {
      const siteDeck = withRescueSite ? [BANDIT_LAIR] : [RIVENDELL];
      const base = buildTestState({
        phase: Phase.MovementHazard,
        activePlayer: PLAYER_1,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FLIES_AND_SPIDERS], siteDeck },
        ],
      });

      const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
      const companyId = companyIdAt(base, RESOURCE_PLAYER);
      const combat = {
        attackSource: { type: 'creature' as const, instanceId: 'fake-spider' as CardInstanceId },
        companyId,
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 5,
        creatureBody: null,
        creatureRace: 'Spider',
        strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
        currentStrikeIndex: 0,
        phase: 'resolve-strike' as const,
        assignmentPhase: 'done' as const,
        bodyCheckTarget: null,
        detainment: false,
      };
      return { ...base, combat, phaseState: makeShadowMHState() };
    }

    const withSite = makeState(true);
    const withoutSite = makeState(false);

    const playableWithSite = viableActions(withSite, PLAYER_2, 'play-hazard').length > 0;
    const playableWithoutSite = viableActions(withoutSite, PLAYER_2, 'play-hazard').length > 0;

    expect(playableWithSite).toBe(true);
    expect(playableWithoutSite).toBe(false);
  });

  test('On successful spider strike: character taken prisoner, not wounded', () => {
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

    // Attach Flies and Spiders to Aragorn's hazards (simulates it being played earlier).
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
              ...p.characters[aragornId as string],
              hazards: [{ instanceId: hostId, definitionId: FLIES_AND_SPIDERS, status: 'Untapped' as const }],
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-spider' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // Creature guaranteed to win
      creatureBody: null,
      creatureRace: 'Spider',
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
    expect(result.players[RESOURCE_PLAYER].characters[aragornId as string].status).not.toBe('Inverted');
    // Prisoner record created.
    expect(result.hazardHosts).toHaveLength(1);
    expect(result.hazardHosts[0].prisoners).toContain(aragornId);
    expect(result.hazardHosts[0].rescueSiteCard.definitionId).toBe(BANDIT_LAIR);
    // Rescue site removed from hazard player's deck.
    expect(result.players[HAZARD_PLAYER].siteDeck.some(s => s.definitionId === BANDIT_LAIR)).toBe(false);
  });
});
