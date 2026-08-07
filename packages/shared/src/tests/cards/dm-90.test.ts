/**
 * @module dm-90.test
 *
 * Card test: Spells of the Barrow-wights (dm-90)
 * Type: hazard-event (permanent)
 *
 * "Playable on a character facing an Undead strike. If the strike is
 * successful, target character is not harmed and is taken prisoner at a
 * Ruins & Lairs [{R}] or Shadow-hold [{S}]. Character must discard any rings
 * along with his other items. At the start of each of his untap phases, make
 * a body check for that character. Rescue-attack: Undead — 3 strikes with
 * 8 prowess."
 *
 * Engine support:
 *   - play-window { phase: "combat", step: "resolve-strike" }
 *   - play-target with filter { "attack.race": "undead" }
 *   - take-prisoner effect: no wound on strike success; prisoner state
 *     created, rescue site drawn from either a ruins-and-lairs or a
 *     shadow-hold in the hazard player's location deck
 *   - discardRings: true — unlike the default CoE 8.35/3.III.3 rule (Flies
 *     and Spiders dm-58), ring items are discarded too, not retained
 *   - untapBodyCheck: a body check enqueued for the prisoner at the start of
 *     each of its owner's untap phases (`enterUntapPhase`); failure
 *     eliminates the character and drops it from the hazard host's
 *     bookkeeping
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, CardInstanceId, Race } from '../../index.js';
import type { PlayerState, ConstraintId, ActiveConstraint, HazardHost, GameState } from '../../index.js';
import {
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  PRECIOUS_GOLD_RING, GLAMDRING,
  buildTestState, buildSitePhaseState, findCharInstanceId, companyIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, dispatch, viableActions,
  makeShadowMHState,
} from '../test-helpers.js';

const SPELLS_OF_THE_BARROW_WIGHTS = 'dm-90' as CardDefinitionId;

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

  test('Playable only if a ruins-and-lairs OR shadow-hold rescue site is in hazard location deck', () => {
    function makeState(hazardSiteDeck: readonly CardDefinitionId[]) {
      const base = buildTestState({
        phase: Phase.MovementHazard,
        activePlayer: PLAYER_1,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SPELLS_OF_THE_BARROW_WIGHTS], siteDeck: [...hazardSiteDeck] },
        ],
      });

      const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
      const companyId = companyIdAt(base, RESOURCE_PLAYER);
      const combat = {
        attackSource: { type: 'creature' as const, instanceId: 'fake-undead' as CardInstanceId },
        companyId,
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 5,
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
    const withShadowHold = makeState([MORIA]);
    const withNeither = makeState([RIVENDELL]);

    expect(viableActions(withRuinsAndLairs, PLAYER_2, 'play-hazard').length > 0).toBe(true);
    expect(viableActions(withShadowHold, PLAYER_2, 'play-hazard').length > 0).toBe(true);
    expect(viableActions(withNeither, PLAYER_2, 'play-hazard').length > 0).toBe(false);
  });

  test('On successful undead strike: character taken prisoner, not wounded, and all items — including rings — discarded', () => {
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

    // Attach the hazard host and give Aragorn a ring and a non-ring item.
    const hostId = `${PLAYER_2 as string}-host1` as CardInstanceId;
    const ringId = 'ring-1' as CardInstanceId;
    const swordId = 'sword-1' as CardInstanceId;
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
              items: [
                { instanceId: ringId, definitionId: PRECIOUS_GOLD_RING, status: 'Untapped' as const },
                { instanceId: swordId, definitionId: GLAMDRING, status: 'Untapped' as const },
              ],
              hazards: [{ instanceId: hostId, definitionId: SPELLS_OF_THE_BARROW_WIGHTS, status: 'Untapped' as const }],
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-undead' as CardInstanceId },
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
    // Both the ring AND the non-ring item were discarded (unlike dm-58, which
    // retains rings per the default CoE 8.35/3.III.3 rule).
    expect(result.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    expect(result.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ringId)).toBe(true);
    expect(result.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === swordId)).toBe(true);
  });

  // ---- Manual rescue (CoE rule 8.36) via the generic rescue-attacks flow ----

  const prisonerAtRescueSite = () => {
    const base = buildSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN] });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const hostId = `${PLAYER_2 as string}-host1` as CardInstanceId;
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const prisonerConstraint: ActiveConstraint = {
      id: 'c-prisoner-sotbw' as ConstraintId,
      source: hostId,
      sourceDefinitionId: SPELLS_OF_THE_BARROW_WIGHTS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-is-prisoner', hostInstanceId: hostId },
    };
    const hazardHost: HazardHost = {
      hostCard: { instanceId: hostId, definitionId: SPELLS_OF_THE_BARROW_WIGHTS },
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

  test('rescue is offered at the rescue site and faces the fixed Undead rescue-attack', () => {
    const { state, aragornId, hostId } = prisonerAtRescueSite();
    const offers = viableActions(state, PLAYER_1, 'rescue-prisoner');
    expect(offers).toHaveLength(1);

    const after = dispatch(state, { type: 'rescue-prisoner', player: PLAYER_1, hostInstanceId: hostId });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('undead');
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.protectedFromStrikeAssignment).toContain(aragornId);
  });

  // ---- Periodic body check at the start of each of the prisoner's untap phases ----

  /**
   * A prisoner (Aragorn, owned by PLAYER_1/RESOURCE_PLAYER) held by a
   * Spells of the Barrow-wights host owned by PLAYER_2, with PLAYER_2 at the
   * end-of-turn signal-end step. Dispatching `pass` as PLAYER_2 ends their
   * turn and enters PLAYER_1's untap phase — Aragorn's own untap phase.
   */
  function prisonerBeforeOwnersUntapPhase() {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_2,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
      recompute: true,
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const hostId = `${PLAYER_2 as string}-host1` as CardInstanceId;
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const prisonerConstraint: ActiveConstraint = {
      id: 'c-prisoner-sotbw-untap' as ConstraintId,
      source: hostId,
      sourceDefinitionId: SPELLS_OF_THE_BARROW_WIGHTS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-is-prisoner', hostInstanceId: hostId },
    };
    const hazardHost: HazardHost = {
      hostCard: { instanceId: hostId, definitionId: SPELLS_OF_THE_BARROW_WIGHTS },
      rescueSiteCard: { instanceId: siteInstanceId, definitionId: MORIA },
      prisoners: [aragornId],
      ownedBy: PLAYER_2,
    };
    const state: GameState = {
      ...base,
      activeConstraints: [...base.activeConstraints, prisonerConstraint],
      hazardHosts: [hazardHost],
      phaseState: {
        phase: Phase.EndOfTurn, step: 'signal-end',
        discardDone: [true, true], resetHandDone: [true, true],
      } as GameState['phaseState'],
    };
    return { state, aragornId, hostId };
  }

  test('entering the prisoner owner\'s untap phase enqueues a body check, rolled by the host\'s owner', () => {
    const { state, aragornId } = prisonerBeforeOwnersUntapPhase();
    const ended = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(ended.phaseState.phase).toBe(Phase.Untap);
    expect(ended.activePlayer).toBe(PLAYER_1);
    expect(ended.pendingResolutions).toHaveLength(1);
    const kind = ended.pendingResolutions[0].kind;
    expect(kind.type).toBe('dice-check');
    if (kind.type !== 'dice-check') throw new Error('expected dice-check');
    expect(kind.threshold).toBe(9); // Aragorn's printed body
    expect(kind.comparison).toBe('gt');
    expect(kind.targetCharacterId).toBe(aragornId);
    expect(ended.pendingResolutions[0].actor).toBe(PLAYER_2); // host's owner rolls (CoE 3.I.1)
  });

  test('failing the body check eliminates the prisoner and discards the (now-empty) host card', () => {
    const { state, aragornId, hostId } = prisonerBeforeOwnersUntapPhase();
    const ended = dispatch(state, { type: 'pass', player: PLAYER_2 });
    const rollActions = viableActions(ended, PLAYER_2, 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    const after = dispatch({ ...ended, cheatRollTotal: 10 }, rollActions[0].action); // 10 > body 9 → eliminated

    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);
    // Prisoner bookkeeping cleaned up: constraint gone, host record dropped,
    // and the (record-only) host card discarded to its owner.
    expect(after.activeConstraints.some(c => c.kind.type === 'character-is-prisoner')).toBe(false);
    expect(after.hazardHosts).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === hostId)).toBe(true);
  });

  test('passing the body check leaves the prisoner held', () => {
    const { state, aragornId, hostId } = prisonerBeforeOwnersUntapPhase();
    const ended = dispatch(state, { type: 'pass', player: PLAYER_2 });
    const rollActions = viableActions(ended, PLAYER_2, 'resolve-dice-check');

    const after = dispatch({ ...ended, cheatRollTotal: 2 }, rollActions[0].action); // 2 <= body 9 → survives

    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(after.activeConstraints.some(
      c => c.kind.type === 'character-is-prisoner' && c.target.kind === 'character' && c.target.characterId === aragornId,
    )).toBe(true);
    expect(after.hazardHosts).toHaveLength(1);
    expect(after.hazardHosts[0].hostCard.instanceId).toBe(hostId);
    expect(after.hazardHosts[0].prisoners).toContain(aragornId);
  });
});
