/**
 * @module td-31.test
 *
 * Card test: Host of Bats (td-31)
 * Type: hazard-event (long)
 *
 * Text: "Against each company, one Orc hazard creature may be played that
 * does not count against the hazard limit. Any character wounded by an Orc
 * attack makes an additional body check modified by -1. Additionally, if
 * Shadow of Mordor is in play, any character wounded by an attack keyed to
 * (or an automatic-attack at) a Shadow-hold [{S}] or a Darkhold [{D}] makes
 * an additional body check modified by -2. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect Type                | Notes                                                         |
 * |---|-----------------------------|----------------------------------------------------------------|
 * | 1 | hazard-limit-race-grant     | race: orc, maxPerCompany 1 (default)                            |
 * | 2 | wound-additional-body-check | modifier -1, when attack.creatureRace = orc                    |
 * | 3 | wound-additional-body-check | modifier -2, when Shadow of Mordor in play AND site is {S}/{D}  |
 * | 4 | duplication-limit           | scope game, max 1 ("Cannot be duplicated")                     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, ORC_GUARD, CAVE_DRAKE,
  RIVENDELL, LORIEN, MORIA,
  buildTestState, resetMint, makeMHState,
  companyIdAt, phaseStateAs,
  findHandCardId, viableActions, viableActionsForHandCard,
  dispatch, findCharInstanceId,
  CardStatus,
} from '../test-helpers.js';
import type { PlayerSetup } from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState, MovementHazardPhaseState,
} from '../../index.js';

const HOST_OF_BATS = 'td-31' as CardDefinitionId;
const SHADOW_OF_MORDOR = 'td-68' as CardDefinitionId;
const HOST_OF_BATS_ID = 'host-of-bats-1' as CardInstanceId;
const SHADOW_OF_MORDOR_ID = 'shadow-of-mordor-1' as CardInstanceId;
const ORC_CREATURE_ID = 'orc-creature-1' as CardInstanceId;

/** Add Host of Bats (and, optionally, Shadow of Mordor) to the hazard player's `cardsInPlay`. */
function withHostOfBats(state: GameState, opts: { shadowOfMordor?: boolean } = {}): GameState {
  const hazard = state.players[HAZARD_PLAYER];
  const players: typeof state.players = [state.players[RESOURCE_PLAYER], {
    ...hazard,
    cardsInPlay: [
      ...hazard.cardsInPlay,
      { instanceId: HOST_OF_BATS_ID, definitionId: HOST_OF_BATS, status: CardStatus.Untapped },
      ...(opts.shadowOfMordor
        ? [{ instanceId: SHADOW_OF_MORDOR_ID, definitionId: SHADOW_OF_MORDOR, status: CardStatus.Untapped }]
        : []),
    ],
  }];
  return { ...state, players };
}

// ---- Section A: hazard-limit-race-grant (effect 1) ----

const GRANT_PLAYERS = (extra: CardDefinitionId[] = []): [PlayerSetup, PlayerSetup] => [
  { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_GUARD, ...extra], siteDeck: [] },
];

describe('Host of Bats (td-31)', () => {
  beforeEach(() => resetMint());

  describe('hazard-limit-race-grant: one Orc creature per company bypasses the hazard limit', () => {
    test('an Orc creature is viable past the hazard limit while Host of Bats is in play', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS(),
      }));
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions.length).toBeGreaterThan(0);
    });

    test('a non-Orc creature (Cave-drake) is NOT exempt — still blocked at the hazard limit', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS([CAVE_DRAKE]),
      }));
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE);
      expect(actions).toHaveLength(0);
    });

    test('only ONE Orc creature per company is exempt — a second is blocked once the grant is used', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS(),
      }));
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          hazardLimitRaceGrantsUsed: [Race.Orc], // this company's grant already spent
          resolvedSitePath: [RegionType.Shadow],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions).toHaveLength(0);
    });

    test('without Host of Bats in play, an Orc creature is blocked normally at the hazard limit', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS(),
      });
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions).toHaveLength(0);
    });

    test('playing the exempt Orc creature does not increment hazardsPlayedThisCompany, and records the grant as used', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: GRANT_PLAYERS(),
      }));
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          resolvedSitePath: [RegionType.Shadow],
        }),
      };
      const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
      const orcGuardId = findHandCardId(gameState, HAZARD_PLAYER, ORC_GUARD);
      const result = dispatch(gameState, {
        type: 'play-hazard',
        player: PLAYER_2,
        cardInstanceId: orcGuardId,
        targetCompanyId: companyId,
        keyedBy: { method: 'region-type', value: RegionType.Shadow },
      });
      const ps = phaseStateAs<MovementHazardPhaseState>(result);
      expect(ps.hazardsPlayedThisCompany).toBe(1); // unchanged — the Orc-guard did not count
      expect(ps.hazardLimitRaceGrantsUsed).toEqual([Race.Orc]);
    });

    test('a second Orc creature after the grant is spent counts against the hazard limit normally', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1, phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_GUARD, ORC_GUARD], siteDeck: [] },
        ],
      }));
      const gameState: GameState = {
        ...base,
        phaseState: makeMHState({
          hazardsPlayedThisCompany: 1,
          hazardLimitAtReveal: 1,
          hazardLimitRaceGrantsUsed: [Race.Orc],
          resolvedSitePath: [RegionType.Shadow],
        }),
      };
      const actions = viableActionsForHandCard(gameState, PLAYER_2, 'play-hazard', HAZARD_PLAYER, ORC_GUARD);
      expect(actions).toHaveLength(0);
    });
  });

  // ---- Section B / C: wound-additional-body-check (effects 2 and 3) ----

  /** Aragorn (body 9) in a stationary company at `site`, facing a manually-built combat. */
  function combatBaseState(site: CardDefinitionId): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return { ...state, phaseState: makeMHState() };
  }

  /** A pending character-target body check: Aragorn (body 9) struck by a hazard creature of `race`. */
  function creatureBodyCheckCombat(state: GameState, race: Race): CombatState {
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    return {
      attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 9,
      creatureRace: race,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false, wasAlreadyWounded: false }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: false,
      detainment: false,
    };
  }

  /** A pending character-target body check: Aragorn (body 9) struck by an automatic-attack of `race` at the company's current site. */
  function autoAttackBodyCheckCombat(state: GameState, race: Race): CombatState {
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const siteInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    return {
      attackSource: { type: 'automatic-attack', siteInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: null,
      creatureRace: race,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false, wasAlreadyWounded: false }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: false,
      detainment: false,
    };
  }

  function addOrcCreatureToHazardPlay(state: GameState): GameState {
    const hazard = state.players[HAZARD_PLAYER];
    const players: typeof state.players = [state.players[RESOURCE_PLAYER], {
      ...hazard,
      cardsInPlay: [...hazard.cardsInPlay, { instanceId: ORC_CREATURE_ID, definitionId: ORC_GUARD, status: CardStatus.Untapped }],
    }];
    return { ...state, players };
  }

  function aragornId(state: GameState): CardInstanceId {
    return findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
  }

  function isEliminated(state: GameState, charId: CardInstanceId): boolean {
    return state.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === charId);
  }

  describe('clause 1: Orc attack wound → additional body check modified by -1', () => {
    test('surviving an Orc-attack wound queues one additional check modified by -1', () => {
      const state = withHostOfBats(addOrcCreatureToHazardPlay(combatBaseState(RIVENDELL)));
      const combat = creatureBodyCheckCombat(state, Race.Orc);
      const ready = { ...state, combat, cheatRollTotal: 9 }; // 9 <= body 9 → survives
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const after = dispatch(ready, bodyCheck.action);

      expect(after.combat).not.toBeNull();
      expect(after.combat!.pendingAdditionalBodyChecks).toEqual([-1]);
      expect(isEliminated(after, aragornId(state))).toBe(false);

      // The re-offered body-check-roll accounts for the -1 modifier: need rises
      // from 10 (body 9 + 1) to 11 (roll must overcome the -1 bonus).
      const [nextCheck] = viableActions(after, PLAYER_2, 'body-check-roll');
      expect(nextCheck.action.type).toBe('body-check-roll');
      if (nextCheck.action.type === 'body-check-roll') {
        expect(nextCheck.action.need).toBe(11);
      }
    });

    test("the additional check's -1 modifier can save the character from what would otherwise be elimination", () => {
      const state = withHostOfBats(addOrcCreatureToHazardPlay(combatBaseState(RIVENDELL)));
      const combat = creatureBodyCheckCombat(state, Race.Orc);
      const survived = dispatch({ ...state, combat, cheatRollTotal: 9 }, viableActions({ ...state, combat, cheatRollTotal: 9 }, PLAYER_2, 'body-check-roll')[0].action);

      // Roll of 10 would eliminate Aragorn outright (10 > 9), but the queued
      // -1 modifier drops the effective roll to 9 — survives.
      const [nextCheck] = viableActions(survived, PLAYER_2, 'body-check-roll');
      const finalState = dispatch({ ...survived, cheatRollTotal: 10 }, nextCheck.action);

      expect(isEliminated(finalState, aragornId(state))).toBe(false);
      expect(finalState.combat).toBeNull(); // queue exhausted, single-strike combat finalizes
      expect(finalState.players[RESOURCE_PLAYER].companies[0].characters).toContain(aragornId(state));
    });

    test('the additional check is a genuine second elimination chance — it can still eliminate despite the -1', () => {
      const state = withHostOfBats(addOrcCreatureToHazardPlay(combatBaseState(RIVENDELL)));
      const combat = creatureBodyCheckCombat(state, Race.Orc);
      const survived = dispatch({ ...state, combat, cheatRollTotal: 9 }, viableActions({ ...state, combat, cheatRollTotal: 9 }, PLAYER_2, 'body-check-roll')[0].action);

      // Roll of 11: even after the -1 modifier, effective roll is 10 > body 9 → eliminated.
      const [nextCheck] = viableActions(survived, PLAYER_2, 'body-check-roll');
      const finalState = dispatch({ ...survived, cheatRollTotal: 11 }, nextCheck.action);

      expect(isEliminated(finalState, aragornId(state))).toBe(true);
    });

    test('without Host of Bats in play, surviving an Orc attack does not queue an additional check', () => {
      const state = addOrcCreatureToHazardPlay(combatBaseState(RIVENDELL));
      const combat = creatureBodyCheckCombat(state, Race.Orc);
      const ready = { ...state, combat, cheatRollTotal: 9 };
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const after = dispatch(ready, bodyCheck.action);

      expect(after.combat).toBeNull(); // resolves immediately — no additional check queued
      expect(isEliminated(after, aragornId(state))).toBe(false);
    });

    test('a non-Orc creature attack does not trigger the additional check even with Host of Bats in play', () => {
      const state = withHostOfBats(combatBaseState(RIVENDELL));
      const combat = creatureBodyCheckCombat(state, Race.Wolf);
      const ready = { ...state, combat, cheatRollTotal: 9 };
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const after = dispatch(ready, bodyCheck.action);

      expect(after.combat).toBeNull();
      expect(isEliminated(after, aragornId(state))).toBe(false);
    });
  });

  describe('clause 2: Shadow-hold/Darkhold wound (with Shadow of Mordor in play) → additional check modified by -2', () => {
    test('an automatic-attack at a Shadow-hold (Moria) with Shadow of Mordor in play queues an additional check modified by -2', () => {
      const state = withHostOfBats(combatBaseState(MORIA), { shadowOfMordor: true });
      const combat = autoAttackBodyCheckCombat(state, Race.Man);
      const ready = { ...state, combat, cheatRollTotal: 9 };
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const after = dispatch(ready, bodyCheck.action);

      expect(after.combat!.pendingAdditionalBodyChecks).toEqual([-2]);
    });

    test('the same automatic-attack WITHOUT Shadow of Mordor in play does not queue an additional check', () => {
      const state = withHostOfBats(combatBaseState(MORIA)); // no Shadow of Mordor
      const combat = autoAttackBodyCheckCombat(state, Race.Man);
      const ready = { ...state, combat, cheatRollTotal: 9 };
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const after = dispatch(ready, bodyCheck.action);

      expect(after.combat).toBeNull();
    });

    test('an Orc automatic-attack at a Shadow-hold with both Host of Bats and Shadow of Mordor in play queues BOTH additional checks (-1 then -2)', () => {
      const state = withHostOfBats(combatBaseState(MORIA), { shadowOfMordor: true });
      const combat = autoAttackBodyCheckCombat(state, Race.Orc);
      const ready = { ...state, combat, cheatRollTotal: 9 };
      const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
      const afterFirst = dispatch(ready, bodyCheck.action);
      expect(afterFirst.combat!.pendingAdditionalBodyChecks).toEqual([-1, -2]);

      // Second roll (the -1 check) survives at 9 — modifier drops effective roll to 8.
      const [secondCheck] = viableActions(afterFirst, PLAYER_2, 'body-check-roll');
      const afterSecond = dispatch({ ...afterFirst, cheatRollTotal: 9 }, secondCheck.action);
      expect(afterSecond.combat!.pendingAdditionalBodyChecks).toEqual([-2]);
      expect(isEliminated(afterSecond, aragornId(state))).toBe(false);

      // Third roll (the -2 check): roll of 11 → effective 9, survives; queue drains, combat finalizes.
      const [thirdCheck] = viableActions(afterSecond, PLAYER_2, 'body-check-roll');
      const afterThird = dispatch({ ...afterSecond, cheatRollTotal: 11 }, thirdCheck.action);
      expect(afterThird.combat).toBeNull();
      expect(isEliminated(afterThird, aragornId(state))).toBe(false);
    });
  });

  // ---- Section D: "Cannot be duplicated" (effect 4) ----

  describe('duplication-limit: cannot be duplicated', () => {
    test('a second copy of Host of Bats is not playable while one is already in play', () => {
      const base = withHostOfBats(buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [HOST_OF_BATS], siteDeck: [] },
        ],
      }));
      const gameState: GameState = { ...base, phaseState: makeMHState() };
      const actions = computeLegalActions(gameState, PLAYER_2).filter(
        ea => ea.viable && ea.action.type === 'play-hazard'
          && ea.action.cardInstanceId === findHandCardId(gameState, HAZARD_PLAYER, HOST_OF_BATS),
      );
      expect(actions).toHaveLength(0);
    });
  });
});
