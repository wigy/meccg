/**
 * @module td-162.test
 *
 * Card test: Vanish in Sunlight! (td-162)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 2
 *
 * Text:
 *   "Modify the prowess of one Nazgûl or Undead attack by -2 (by -4 if
 *    Gates of Morning is in play)."
 *
 * Engine Support:
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Offered against a Nazgûl (race "ringwraith") attack, -2 prowess| IMPLEMENTED |
 * | 2 | Offered against an Undead attack, -2 prowess                  | IMPLEMENTED |
 * | 3 | NOT offered against a non-Nazgûl/Undead attack (Orc)           | IMPLEMENTED |
 * | 4 | -4 prowess instead of -2 when Gates of Morning is in play      | IMPLEMENTED |
 * | 5 | Playing it modifies the live attack's strike prowess           | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-09-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, mint,
  makeMHState,
  findHandCardId,
  viableActions, reduce,
  actionAs, companyIdAt,
  GATES_OF_MORNING, BARROW_WIGHT, ORC_PATROL,
} from '../test-helpers.js';
import { Phase, CardStatus, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, CombatState, GameState,
  ModifyAttackAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

const VANISH_IN_SUNLIGHT = 'td-162' as CardDefinitionId;

/** Akhôrahil — hazard-creature, race "ringwraith" (a Nazgûl). */
const AKHORAHIL = 'tw-4' as CardDefinitionId;

const ARAGORN = 'tw-120' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;
const THEODEN = 'tw-182' as CardDefinitionId;

const RIVENDELL = 'tw-421' as CardDefinitionId;
const LORIEN = 'tw-408' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;

/** Build an organization-phase base state: PLAYER_1 active, holding `heroHand`. */
function baseState(heroHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: heroHand, siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

/** Adds cards directly to a player's `cardsInPlay` (bypassing normal play). */
function withCardsInPlay(state: GameState, playerIdx: number, defIds: readonly CardDefinitionId[]): GameState {
  const inPlay: CardInPlay[] = defIds.map(definitionId => ({ instanceId: mint(), definitionId, status: CardStatus.Untapped }));
  const players = state.players.map((p, i) => i === playerIdx ? { ...p, cardsInPlay: [...p.cardsInPlay, ...inPlay] } : p) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Overwrites `state` with a live combat: `creatureDefId` (of race `race`)
 * attacks PLAYER_1's company (PLAYER_1 defends, PLAYER_2 attacks). Mirrors
 * the manual combat construction used by Sated Beast (td-149.test.ts).
 */
function attackWith(state: GameState, creatureDefId: CardDefinitionId, race: Race, strikeProwess = 15): GameState {
  const creatureInstanceId = 'creature-1' as CardInstanceId;
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const players = [
    state.players[RESOURCE_PLAYER],
    {
      ...hazardPlayer,
      cardsInPlay: [
        ...hazardPlayer.cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: creatureDefId, status: CardStatus.Untapped },
      ],
    },
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess,
    creatureBody: null,
    creatureRace: race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('Vanish in Sunlight! (td-162)', () => {
  beforeEach(() => resetMint());

  test('offered as a modify-attack against a Nazgûl (ringwraith) attack', () => {
    const state = attackWith(baseState([VANISH_IN_SUNLIGHT]), AKHORAHIL, Race.Ringwraith);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANISH_IN_SUNLIGHT);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === cardId);
    expect(actions).toHaveLength(1);
  });

  test('offered as a modify-attack against an Undead attack', () => {
    const state = attackWith(baseState([VANISH_IN_SUNLIGHT]), BARROW_WIGHT, Race.Undead);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANISH_IN_SUNLIGHT);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === cardId);
    expect(actions).toHaveLength(1);
  });

  test('NOT offered against a non-Nazgûl/Undead attack (Orc)', () => {
    const state = attackWith(baseState([VANISH_IN_SUNLIGHT]), ORC_PATROL, Race.Orc);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANISH_IN_SUNLIGHT);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === cardId);
    expect(actions).toHaveLength(0);
  });

  test('playing it against a Nazgûl attack modifies strike prowess by -2 without Gates of Morning', () => {
    const state = attackWith(baseState([VANISH_IN_SUNLIGHT]), AKHORAHIL, Race.Ringwraith, 16);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANISH_IN_SUNLIGHT);

    const result = reduce(state, { type: 'modify-attack', player: PLAYER_1, cardInstanceId: cardId });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.strikeProwess).toBe(14);
  });

  test('playing it against an Undead attack modifies strike prowess by -4 when Gates of Morning is in play', () => {
    const withGates = withCardsInPlay(baseState([VANISH_IN_SUNLIGHT]), HAZARD_PLAYER, [GATES_OF_MORNING]);
    const state = attackWith(withGates, BARROW_WIGHT, Race.Undead, 12);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANISH_IN_SUNLIGHT);

    const result = reduce(state, { type: 'modify-attack', player: PLAYER_1, cardInstanceId: cardId });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
  });
});
