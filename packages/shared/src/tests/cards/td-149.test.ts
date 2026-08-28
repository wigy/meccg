/**
 * @module td-149.test
 *
 * Card test: Sated Beast (td-149)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 3
 *
 * Text:
 *   "Target ahunt Dragon manifestation is discarded. Alternatively, if
 *    Doors of Night is in play, decreases the number of strikes from one
 *    Dragon or Drake attack by one (to a minimum of one). This card may
 *    also be played during opponent's movement/hazard phase."
 *
 * Engine Support:
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Discards a target ahunt Dragon manifestation (any player's)   | IMPLEMENTED |
 * | 2 | Only matches "ahunt" long-events, not "at home" permanents    | IMPLEMENTED |
 * | 3 | Alt mode: -1 strike on a Dragon/Drake attack if Doors of Night| IMPLEMENTED |
 * | 4 | Alt mode gated off without Doors of Night in play             | IMPLEMENTED |
 * | 5 | Alt mode gated off against non-Dragon/Drake attacks           | IMPLEMENTED |
 * | 6 | Strike reduction floors at a minimum of one                   | IMPLEMENTED |
 * | 7 | Playable during any phase of the owner's own turn (2.1.1)     | IMPLEMENTED |
 * | 8 | Also playable during the opponent's movement/hazard phase     | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, mint,
  makeMHState, makeSitePhase,
  findHandCardId,
  viableActions, dispatch, resolveChain,
  expectInDiscardPile, expectNotInPile,
  actionAs, companyIdAt,
  DOORS_OF_NIGHT,
} from '../test-helpers.js';
import { Phase, CardStatus, Race, computeLegalActions, reduce } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, CombatState, GameState,
  PlayShortEventAction, ModifyAttackAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

const SATED_BEAST = 'td-149' as CardDefinitionId;

/** Agburanar Ahunt — hazard-event (long), manifestId tw-3. The card's primary target. */
const AGBURANAR_AHUNT = 'td-1' as CardDefinitionId;
/** Smaug Ahunt — hazard-event (long), a second, distinct Ahunt manifestation. */
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
/** Agburanar at Home — hazard-event (PERMANENT), same manifestId (tw-3) as td-1, but
 * NOT an "ahunt" manifestation — must not be a valid target. */
const AGBURANAR_AT_HOME = 'td-2' as CardDefinitionId;

/** Cave-drake — hazard creature, race "dragon". */
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;
/** Land-drake — hazard creature, race "drake". */
const LAND_DRAKE = 'td-40' as CardDefinitionId;
/** Orc-patrol — hazard creature, race "orc" (negative control: not Dragon/Drake). */
const ORC_PATROL = 'tw-074' as CardDefinitionId;

const ARAGORN = 'tw-120' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;
const THEODEN = 'tw-182' as CardDefinitionId;

const RIVENDELL = 'tw-421' as CardDefinitionId;
const LORIEN = 'tw-408' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;

/** Build an organization-phase base state: PLAYER_1 active, holding `heroHand`. */
function orgBaseState(heroHand: CardDefinitionId[]): GameState {
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

/** Build a M/H-phase base state, `activePlayer` moving, `nonActiveHand` on the other player. */
function mhBaseState(activePlayer: typeof PLAYER_1, nonActiveHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
        hand: activePlayer === PLAYER_1 ? [] : nonActiveHand,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [THEODEN] }],
        hand: activePlayer === PLAYER_2 ? [] : nonActiveHand,
        siteDeck: [MORIA],
      },
    ],
  });
}

/**
 * Overwrites `state` with a live combat: `creatureDefId` (of race `race`)
 * attacks PLAYER_1's company (PLAYER_1 defends, PLAYER_2 attacks). Mirrors
 * the manual combat construction used by Alert the Folk (td-97.test.ts).
 */
function attackWith(state: GameState, creatureDefId: CardDefinitionId, race: Race, strikesTotal = 3): GameState {
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
    strikesTotal,
    strikeProwess: 15,
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

describe('Sated Beast (td-149)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: discards a target ahunt Dragon manifestation ────────────────

  test('playable during organization phase, targeting an Ahunt manifestation in the opponent\'s cardsInPlay', () => {
    const state = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [AGBURANAR_AHUNT]);
    const ahuntId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.discardTargetInstanceId).toBe(ahuntId);
  });

  test('one action per eligible Ahunt when multiple are in play', () => {
    const state = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [AGBURANAR_AHUNT, SMAUG_AHUNT]);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);
    const targets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId);
    expect(new Set(targets).size).toBe(2);
  });

  // ── Rule 2: only "ahunt" long-events, not "at home" permanent-events ────

  test('does NOT target a Dragon "at Home" permanent-event (only "ahunt" long-events)', () => {
    const state = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [AGBURANAR_AT_HOME]);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when no ahunt manifestation is in play', () => {
    const state = orgBaseState([SATED_BEAST]);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('resolving discards the target Ahunt to its owner\'s discard pile and discards Sated Beast', () => {
    const state = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [AGBURANAR_AHUNT]);
    const ahuntId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: satedId,
      discardTargetInstanceId: ahuntId,
    }));

    expect(next.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId)).not.toContain(ahuntId);
    expectInDiscardPile(next, HAZARD_PLAYER, AGBURANAR_AHUNT);
    expectInDiscardPile(next, RESOURCE_PLAYER, SATED_BEAST);
    expectNotInPile(next, RESOURCE_PLAYER, 'hand', SATED_BEAST);
  });

  // ── Rule 7 & 8: playable during the owner's own turn (any phase) and ───
  // ── also during the opponent's movement/hazard phase ────────────────────

  test('playable during the owner\'s own site phase despite the crossTurn play-window\'s phase restriction', () => {
    // The card's `play-window` names `movement-hazard` only for the
    // opponent's-turn allowance; own-turn play must remain unrestricted by
    // phase (rule 2.1.1's default "any phase of your own turn").
    const base = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [AGBURANAR_AHUNT]);
    const state = { ...base, phaseState: makeSitePhase() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
  });

  test('playable during the OPPONENT\'s movement/hazard phase (play-hazards step)', () => {
    const base = mhBaseState(PLAYER_2, [SATED_BEAST]);
    const withAhunt = withCardsInPlay(base, HAZARD_PLAYER, [AGBURANAR_AHUNT]);
    const state = { ...withAhunt, phaseState: makeMHState() };
    const ahuntId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.discardTargetInstanceId).toBe(ahuntId);
  });

  test('resolving during the opponent\'s M/H phase discards the Ahunt and leaves the active player\'s turn intact', () => {
    const base = mhBaseState(PLAYER_2, [SATED_BEAST]);
    const withAhunt = withCardsInPlay(base, HAZARD_PLAYER, [AGBURANAR_AHUNT]);
    const state = { ...withAhunt, phaseState: makeMHState() };
    const ahuntId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: satedId,
      discardTargetInstanceId: ahuntId,
    }));

    expect(next.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId)).not.toContain(ahuntId);
    expectInDiscardPile(next, HAZARD_PLAYER, AGBURANAR_AHUNT);
    expectInDiscardPile(next, RESOURCE_PLAYER, SATED_BEAST);
    // The active (moving) player is still PLAYER_2, mid M/H phase.
    expect(next.activePlayer).toBe(PLAYER_2);
    expect(next.phaseState.phase).toBe(Phase.MovementHazard);
  });

  test('not offered to the non-active player during the opponent\'s organization phase (crossTurn is M/H-only)', () => {
    const base = withCardsInPlay(
      buildTestState({
        activePlayer: PLAYER_2,
        phase: Phase.Organization,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [SATED_BEAST], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
        ],
      }),
      HAZARD_PLAYER,
      [AGBURANAR_AHUNT],
    );

    const opponentActions = computeLegalActions(base, PLAYER_1);
    const playActions = opponentActions.filter(a => a.viable && a.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  // ── Rule 3: alt mode — decreases strikes of a Dragon/Drake attack by one ─

  test('offered as a modify-attack when defending against a Dragon attack with Doors of Night in play', () => {
    const withDoors = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [DOORS_OF_NIGHT]);
    const state = attackWith(withDoors, CAVE_DRAKE, Race.Dragon);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === satedId);
    expect(actions).toHaveLength(1);
  });

  test('offered as a modify-attack when defending against a Drake attack with Doors of Night in play', () => {
    const withDoors = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [DOORS_OF_NIGHT]);
    const state = attackWith(withDoors, LAND_DRAKE, Race.Drake);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === satedId);
    expect(actions).toHaveLength(1);
  });

  // ── Rule 4: alt mode requires Doors of Night in play ─────────────────────

  test('NOT offered against a Dragon attack when Doors of Night is not in play', () => {
    const state = attackWith(orgBaseState([SATED_BEAST]), CAVE_DRAKE, Race.Dragon);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === satedId);
    expect(actions).toHaveLength(0);
  });

  // ── Rule 5: alt mode requires a Dragon/Drake attack ──────────────────────

  test('NOT offered against a non-Dragon/Drake attack (Orc) even with Doors of Night in play', () => {
    const withDoors = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [DOORS_OF_NIGHT]);
    const state = attackWith(withDoors, ORC_PATROL, Race.Orc);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const actions = viableActions(state, PLAYER_1, 'modify-attack')
      .filter(a => actionAs<ModifyAttackAction>(a.action).cardInstanceId === satedId);
    expect(actions).toHaveLength(0);
  });

  test('playing it reduces the attack\'s strikes by one', () => {
    const withDoors = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [DOORS_OF_NIGHT]);
    const state = attackWith(withDoors, CAVE_DRAKE, Race.Dragon, 3);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const result = reduce(state, { type: 'modify-attack', player: PLAYER_1, cardInstanceId: satedId });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
  });

  // ── Rule 6: strike reduction floors at a minimum of one ──────────────────

  test('reducing a one-strike attack keeps it at a minimum of one strike', () => {
    const withDoors = withCardsInPlay(orgBaseState([SATED_BEAST]), HAZARD_PLAYER, [DOORS_OF_NIGHT]);
    const state = attackWith(withDoors, CAVE_DRAKE, Race.Dragon, 1);
    const satedId = findHandCardId(state, RESOURCE_PLAYER, SATED_BEAST);

    const result = reduce(state, { type: 'modify-attack', player: PLAYER_1, cardInstanceId: satedId });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.strikesTotal).toBe(1);
  });
});
