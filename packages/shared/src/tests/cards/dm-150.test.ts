/**
 * @module dm-150.test
 *
 * Card test: More Alert than Most (dm-150)
 * Type: hero-resource-event (permanent)
 * Effects: 4
 *   1. stat-modifier strikes -1 (target: attacker-chooses-defenders-attacks), min 1
 *   2. stat-modifier strikes -1 more when Gates of Morning is in play (same target), min 1
 *   3. on-event: attack-defeated — discard self when an attacker-chooses-defenders
 *      attack is defeated
 *   4. duplication-limit scope: game max: 1 — cannot be duplicated
 *
 * Card text:
 *   "The number of strikes of any attack that chooses defending characters is
 *    reduced by one (by 2 if Gates of Morning is in play) to a minimum of
 *    one. Discard when such an attack is defeated. Cannot be duplicated."
 *
 * Test creature: Cave-drake (tw-020) — Dragon, 2 strikes, 10 prowess,
 *   "Attacker chooses defending characters", keyed to double-wilderness +
 *   Ruins-and-lairs. With More Alert than Most in play: 1 strike (2 - 1).
 *   With Gates of Morning also in play: 1 strike (2 - 2 = 0, floored to 1).
 *
 * Contrast creature: Orc-patrol (tw-074) — normal defender-assigns attack
 *   (no attacker-chooses-defenders rule), unaffected by the reduction and by
 *   the discard-on-defeat trigger.
 *
 * | # | Effect                                          | Status      |
 * |---|--------------------------------------------------|-------------|
 * | 1 | stat-modifier strikes -1 (attacker-chooses-...)  | IMPLEMENTED |
 * | 2 | stat-modifier strikes -1 more if Gates of Morning | IMPLEMENTED |
 * | 3 | on-event: attack-defeated, discard               | IMPLEMENTED |
 * | 4 | duplication-limit (game, max 1)                  | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, ORC_PATROL, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, makeWildernessMHState,
  resolveChain, handCardId, companyIdAt, dispatch,
  addCardInPlay, continueAutoAttackCombat,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';
import { Phase, computeLegalActions } from '../../index.js';

const MORE_ALERT_THAN_MOST = 'dm-150' as CardDefinitionId;

/** More Alert than Most as a card in player 1's (hero) cardsInPlay. */
const moreAlertInPlay: CardInPlay = {
  instanceId: 'mata-1' as CardInstanceId,
  definitionId: MORE_ALERT_THAN_MOST,
  status: CardStatus.Untapped,
};

const gomInPlay: CardInPlay = {
  instanceId: 'gom-1' as CardInstanceId,
  definitionId: GATES_OF_MORNING,
  status: CardStatus.Untapped,
};

/** Plays Cave-drake (attacker-chooses-defenders) against P1's company. */
function buildCaveDrakeCombat(heroCardsInPlay: CardInPlay[], heroChars: CardDefinitionId[]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: heroChars }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: heroCardsInPlay },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
    ],
  });
  const gameState = { ...state, phaseState: makeWildernessMHState() };
  const cavedrakeId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const afterPlay = dispatch(gameState, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: cavedrakeId,
    targetCompanyId: companyId,
    keyedBy: { method: 'region-type' as const, value: 'wilderness' },
  });
  return resolveChain(afterPlay);
}

/** Plays Orc-patrol (normal defender-assigns) against P1's company. */
function buildOrcPatrolCombat(heroCardsInPlay: CardInPlay[], heroChars: CardDefinitionId[]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: heroChars }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: heroCardsInPlay },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
    ],
  });
  const gameState = { ...state, phaseState: makeWildernessMHState() };
  const orcId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const afterPlay = dispatch(gameState, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: orcId,
    targetCompanyId: companyId,
    keyedBy: { method: 'region-type' as const, value: 'wilderness' },
  });
  return resolveChain(afterPlay);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('More Alert than Most (dm-150)', () => {
  beforeEach(() => resetMint());

  test('reduces an attacker-chooses-defenders attack by 1 strike (Cave-drake: 2 → 1)', () => {
    const afterChain = buildCaveDrakeCombat([moreAlertInPlay], [ARAGORN, LEGOLAS]);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    // Prowess is untouched by this card — only strikes are reduced.
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('reduces by 2 when Gates of Morning is also in play, floored at a minimum of 1 (not 0)', () => {
    const afterChain = buildCaveDrakeCombat([moreAlertInPlay, gomInPlay], [ARAGORN, LEGOLAS]);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('does not affect an attack that does not choose defending characters (Orc-patrol stays at 3 strikes)', () => {
    const afterChain = buildOrcPatrolCombat([moreAlertInPlay], [ARAGORN, LEGOLAS, GIMLI]);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
  });

  test('has no effect at all (no card in play) — Cave-drake keeps its printed 2 strikes', () => {
    const afterChain = buildCaveDrakeCombat([], [ARAGORN, LEGOLAS]);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
  });

  test('discards itself when an attacker-chooses-defenders attack is fully defeated', () => {
    // Single-character company: the lone strike (2 - 1 = 1) can only go to Aragorn.
    const afterChain = buildCaveDrakeCombat([moreAlertInPlay], [ARAGORN]);
    expect(afterChain.combat!.strikesTotal).toBe(1);

    // Defender passes the cancel-window so the attacker can assign the strike.
    const cancelPassed = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(cancelPassed.combat!.assignmentPhase).toBe('attacker');

    const { state: after } = continueAutoAttackCombat(
      cancelPassed,
      [{ characterDefId: ARAGORN, roll: 12 }],
      PLAYER_1,
      PLAYER_2,
    );

    expect(after.combat).toBeNull();
    expect(after.players[0].cardsInPlay.map(c => c.definitionId)).not.toContain(MORE_ALERT_THAN_MOST);
    expect(after.players[0].discardPile.map(c => c.definitionId)).toContain(MORE_ALERT_THAN_MOST);
  });

  test('does not discard when the defeated attack does not choose defending characters', () => {
    const afterChain = buildOrcPatrolCombat([moreAlertInPlay], [ARAGORN, LEGOLAS, GIMLI]);
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    const { state: after } = continueAutoAttackCombat(
      afterChain,
      [
        { characterDefId: ARAGORN, roll: 12 },
        { characterDefId: LEGOLAS, roll: 12 },
        { characterDefId: GIMLI, roll: 12 },
      ],
      PLAYER_1,
      PLAYER_2,
    );

    expect(after.combat).toBeNull();
    expect(after.players[0].cardsInPlay.map(c => c.definitionId)).toContain(MORE_ALERT_THAN_MOST);
    expect(after.players[0].discardPile.map(c => c.definitionId)).not.toContain(MORE_ALERT_THAN_MOST);
  });

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MORE_ALERT_THAN_MOST], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, MORE_ALERT_THAN_MOST);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');
    expect(playActions.every(a => !a.viable)).toBe(true);
  });

  test('can be played normally when no copy is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [MORE_ALERT_THAN_MOST], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions.length).toBeGreaterThan(0);
  });
});
