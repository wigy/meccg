/**
 * @module td-104.test
 *
 * Card test: Cloudless Day (td-104)
 * Type: hero-resource-event (Long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Playable only if Gates of Morning is in play. Whenever a
 *    company faces a hazard creature attack, the defender may choose which
 *    characters in the company will be the targets of the attack's strikes
 *    (regardless of tapped status, wounded status, and the normal abilities
 *    of the attack)."
 *
 * Effects:
 * | # | Effect                                          | Rule covered                                    |
 * |---|--------------------------------------------------|--------------------------------------------------|
 * | 1 | play-condition (card-in-play, Gates of Morning)   | "Playable only if Gates of Morning is in play"    |
 * | 2 | free-strike-assignment                            | "the defender may choose which characters …
 * |   |                                                    | (regardless of tapped status, wounded status,
 * |   |                                                    | and the normal abilities of the attack)"          |
 *
 * Engine support (new for this card, precedent Fog tw-241 / Fifteen Birds in
 * Five Firtrees dm-129):
 * - `play-condition` `requires: 'card-in-play'` gates hero-resource
 *   long-event play (`legal-actions/long-event.ts`), same path as Fog.
 * - `free-strike-assignment` is a new environment effect, resolved by
 *   `resolveDefenderFreeStrikeAssignment` (`reducer-utils.ts`) at every
 *   hazard-creature-sourced (`creature` / `on-guard-creature` /
 *   `played-auto-attack`) combat-initiation site — the same "hazard creature
 *   attack" source set `tap-on-strike-assignment` (dm-129) uses. When
 *   granted, it (a) suppresses the attack's own
 *   `combat-attacker-chooses-defenders` rule so assignment opens in the
 *   defender's own phase instead of a cancel-window/attacker phase, and
 *   (b) sets `CombatState.defenderFreeStrikeAssignment`, which
 *   `assignStrikeActions` (`legal-actions/combat.ts`) consults to drop its
 *   untapped-only gate for both characters and allies.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, ORC_PATROL,
  GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState,
  addCardInPlay, setCharStatus,
  playLongEventAndResolve,
  resolveChain,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  actionAs,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayLongEventAction, NotPlayableAction, EvaluatedAction,
} from '../../index.js';

const CLOUDLESS_DAY = 'td-104' as CardDefinitionId;

/** Resource player (PLAYER_1) holds Cloudless Day and a company; hazard player (PLAYER_2) is idle. */
function baseLongEventState(resourceHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.LongEvent,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: resourceHand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

function resourceHandInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** M/H base state: P1's company (Aragorn + Legolas) faces P2's creature hand card. */
function baseCombatState(hazardHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
}

/** Plays the given hazard creature (wilderness-keyed) against P1's company. */
function faceCreature(state: GameState, creatureDefId: CardDefinitionId): GameState {
  const mhState = makeWildernessMHState();
  const gameState = { ...state, phaseState: mhState };
  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const afterPlay = dispatch(gameState, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: creatureId,
    targetCompanyId: companyId,
    keyedBy: { method: 'region-type' as const, value: 'wilderness' },
  });
  return resolveChain(afterPlay);
}

describe('Cloudless Day (td-104)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: "Playable only if Gates of Morning is in play" ────────────────

  test('not playable while Gates of Morning is absent, playable once it is in play', () => {
    const state = baseLongEventState([CLOUDLESS_DAY]);
    const inst = resourceHandInstance(state, CLOUDLESS_DAY);
    const isCloudlessDayAction = (ea: EvaluatedAction) => {
      if (ea.action.type === 'not-playable') return actionAs<NotPlayableAction>(ea.action).cardInstanceId === inst;
      if (ea.action.type === 'play-long-event') return actionAs<PlayLongEventAction>(ea.action).cardInstanceId === inst;
      return false;
    };

    const withoutGom = computeLegalActions(state, PLAYER_1).find(isCloudlessDayAction);
    expect(withoutGom?.viable).toBe(false);
    expect(withoutGom?.action.type).toBe('not-playable');
    expect(withoutGom?.reason).toMatch(/Gates of Morning/);

    const withGom = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const withGomAction = computeLegalActions(withGom, PLAYER_1).find(isCloudlessDayAction);
    expect(withGomAction?.viable).toBe(true);
    expect(withGomAction?.action.type).toBe('play-long-event');
  });

  test('resolving Cloudless Day moves it from hand into the resource player\'s cardsInPlay', () => {
    const state = addCardInPlay(baseLongEventState([CLOUDLESS_DAY]), RESOURCE_PLAYER, GATES_OF_MORNING);
    const inst = resourceHandInstance(state, CLOUDLESS_DAY);
    const after = playLongEventAndResolve(state, PLAYER_1, inst);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === CLOUDLESS_DAY)).toBe(false);
  });

  // ─── Rule 2: free choice of strike targets, regardless of tapped/wounded status ──

  describe('free strike assignment against a normal creature (Orc-patrol)', () => {
    test('without Cloudless Day, a tapped character is NOT offered a strike', () => {
      let state = baseCombatState([ORC_PATROL]);
      state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
      const after = faceCreature(state, ORC_PATROL);
      expect(after.combat!.assignmentPhase).toBe('defender');

      const assignActions = viableActions(after, PLAYER_1, 'assign-strike');
      const targets = assignActions.map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
      const aragornId = Object.entries(after.players[RESOURCE_PLAYER].characters)
        .find(([, c]) => c.definitionId === ARAGORN)![0] as CardInstanceId;
      expect(targets).not.toContain(aragornId);
    });

    test('with Cloudless Day + Gates of Morning in play, a tapped character IS offered a strike', () => {
      let state = baseCombatState([ORC_PATROL]);
      state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
      state = addCardInPlay(state, RESOURCE_PLAYER, CLOUDLESS_DAY);
      state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
      const after = faceCreature(state, ORC_PATROL);
      expect(after.combat!.assignmentPhase).toBe('defender');
      expect(after.combat!.defenderFreeStrikeAssignment).toBe(true);

      const assignActions = viableActions(after, PLAYER_1, 'assign-strike');
      const targets = assignActions.map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
      const aragornId = Object.entries(after.players[RESOURCE_PLAYER].characters)
        .find(([, c]) => c.definitionId === ARAGORN)![0] as CardInstanceId;
      expect(targets).toContain(aragornId);
    });

    test('with Cloudless Day + Gates of Morning in play, a wounded character IS offered a strike', () => {
      let state = baseCombatState([ORC_PATROL]);
      state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
      state = addCardInPlay(state, RESOURCE_PLAYER, CLOUDLESS_DAY);
      state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
      const after = faceCreature(state, ORC_PATROL);

      const assignActions = viableActions(after, PLAYER_1, 'assign-strike');
      const targets = assignActions.map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
      const aragornId = Object.entries(after.players[RESOURCE_PLAYER].characters)
        .find(([, c]) => c.definitionId === ARAGORN)![0] as CardInstanceId;
      expect(targets).toContain(aragornId);
    });

    test('the reducer accepts assigning a strike to the tapped character it offered', () => {
      let state = baseCombatState([ORC_PATROL]);
      state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
      state = addCardInPlay(state, RESOURCE_PLAYER, CLOUDLESS_DAY);
      state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
      const after = faceCreature(state, ORC_PATROL);
      const aragornId = Object.entries(after.players[RESOURCE_PLAYER].characters)
        .find(([, c]) => c.definitionId === ARAGORN)![0] as CardInstanceId;

      const assigned = dispatch(after, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
      expect(assigned.combat!.strikeAssignments.some(a => a.characterId === aragornId)).toBe(true);
    });
  });

  // ─── Rule 2 also overrides "the normal abilities of the attack" ────────────

  describe('free strike assignment overrides attacker-chooses-defenders (Cave-drake)', () => {
    test('without Cloudless Day, Cave-drake opens a cancel-window then hands assignment to the attacker', () => {
      const state = baseCombatState([CAVE_DRAKE]);
      const after = faceCreature(state, CAVE_DRAKE);
      expect(after.combat!.assignmentPhase).toBe('cancel-window');
      expect(viableActions(after, PLAYER_1, 'assign-strike')).toHaveLength(0);
    });

    test('with Cloudless Day + Gates of Morning in play, Cave-drake assignment opens directly in the defender\'s phase', () => {
      let state = baseCombatState([CAVE_DRAKE]);
      state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
      state = addCardInPlay(state, RESOURCE_PLAYER, CLOUDLESS_DAY);
      const after = faceCreature(state, CAVE_DRAKE);

      expect(after.combat!.assignmentPhase).toBe('defender');
      expect(after.combat!.defenderFreeStrikeAssignment).toBe(true);
      expect(after.combat!.attackerChoosesDefenders).toBeUndefined();

      const defenderAssignStrikes = viableActions(after, PLAYER_1, 'assign-strike');
      expect(defenderAssignStrikes.length).toBeGreaterThan(0);
      // The attacker no longer gets a strike-assignment turn for this attack.
      expect(viableFor(after, PLAYER_2).some(ea => ea.action.type === 'assign-strike')).toBe(false);
    });

    test('with Cloudless Day in play, the defender may assign to an already-tapped character', () => {
      let state = baseCombatState([CAVE_DRAKE]);
      state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
      state = addCardInPlay(state, RESOURCE_PLAYER, CLOUDLESS_DAY);
      state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
      const after = faceCreature(state, CAVE_DRAKE);

      const assignActions = viableActions(after, PLAYER_1, 'assign-strike');
      const targets = assignActions.map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
      const aragornId = Object.entries(after.players[RESOURCE_PLAYER].characters)
        .find(([, c]) => c.definitionId === ARAGORN)![0] as CardInstanceId;
      expect(targets).toContain(aragornId);
    });
  });
});
