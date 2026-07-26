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
import type { PlayerState, ConstraintId, ActiveConstraint, HazardHost, SitePhaseState, RescuePrisonerAction } from '../../index.js';
import {
  ARAGORN, LEGOLAS, GIMLI, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  buildTestState, buildSitePhaseState, findCharInstanceId, companyIdAt,
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
      creatureRace: 'orc', // Not a Spider
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
        creatureRace: 'spider',
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
              ...p.characters[aragornId],
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
      creatureRace: 'spider',
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

  // ---- Manual rescue (CoE rule 8.36) via the generic rescue-attacks flow ----

  /**
   * A site-phase state at the rescue site (Bandit Lair) with a 2-character
   * company where Aragorn is a prisoner of a Flies and Spiders host (which
   * lives only in the HazardHost record, not in cardsInPlay) and Gimli is free
   * to rescue. Mirrors the post-capture state once the company has reached the
   * rescue site.
   */
  const prisonerAtRescueSite = () => {
    const base = buildSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN, GIMLI] });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const hostId = `${PLAYER_2 as string}-host1` as CardInstanceId;
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const prisonerConstraint: ActiveConstraint = {
      id: 'c-prisoner-fs' as ConstraintId,
      source: hostId,
      sourceDefinitionId: FLIES_AND_SPIDERS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-is-prisoner', hostInstanceId: hostId },
    };
    const hazardHost: HazardHost = {
      hostCard: { instanceId: hostId, definitionId: FLIES_AND_SPIDERS },
      rescueSiteCard: { instanceId: siteInstanceId, definitionId: BANDIT_LAIR },
      prisoners: [aragornId],
      ownedBy: PLAYER_2,
    };
    const state = {
      ...base,
      activeConstraints: [...base.activeConstraints, prisonerConstraint],
      hazardHosts: [hazardHost],
    };
    return { state, aragornId, hostId };
  };

  test('rescue is offered at the rescue site and faces the fixed Spider rescue-attack', () => {
    const { state, aragornId, hostId } = prisonerAtRescueSite();
    const offers = viableActions(state, PLAYER_1, 'rescue-prisoner');
    expect(offers).toHaveLength(1);
    expect((offers[0].action as RescuePrisonerAction).hostInstanceId).toBe(hostId);

    const after = dispatch(state, { type: 'rescue-prisoner', player: PLAYER_1, hostInstanceId: hostId });
    // The rescue-attack is the host's fixed rescueAttacks (Spiders 3 strikes / 9
    // prowess), NOT Bandit Lair's own automatic-attack.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('spider');
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.trollPursePrisoner).toBeUndefined();
    expect(after.combat!.protectedFromStrikeAssignment).toContain(aragornId);
    expect((after.phaseState as SitePhaseState).step).toBe('rescue-attacks');
  });

  test('once the rescue-attack is faced, the prisoner is freed and the host card is discarded', () => {
    const { state, aragornId, hostId } = prisonerAtRescueSite();
    // Flies and Spiders has a single rescue-attack; simulate it already faced.
    const ready = {
      ...state,
      combat: null,
      phaseState: {
        ...state.phaseState,
        step: 'rescue-attacks',
        rescueInProgress: { hostInstanceId: hostId, resolved: 1 },
      } as SitePhaseState,
    };
    const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });

    const stillPrisoner = after.activeConstraints.some(
      c => c.target.kind === 'character' && c.target.characterId === aragornId && c.kind.type === 'character-is-prisoner',
    );
    expect(stillPrisoner).toBe(false);
    expect(after.hazardHosts).toHaveLength(0);
    // The host card lived only in the record — it is discarded to its owner.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FLIES_AND_SPIDERS)).toBe(true);
    expect((after.phaseState as SitePhaseState).step).toBe('play-resources');
  });
});
