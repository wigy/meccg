/**
 * @module tw-060.test
 *
 * Card test: Lure of the Senses (tw-60)
 * Type: hazard-event (permanent, character-targeting corruption hazard)
 * Effects: 5 (play-target character, duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event untap-phase-end when bearer.atHaven force-check corruption,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:7)
 *
 * "Corruption. Playable on a non-Ringwraith character. Target character
 *  receives 2 corruption points and makes a corruption check at the end
 *  of his untap phase if at a Haven/Darkhaven. During his organization
 *  phase, the character may tap to attempt to remove this card. Make a
 *  roll—if the result is greater than 6, discard this card. Cannot be
 *  duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                  |
 * |---|----------------------------------------|-------------|----------------------------------------|
 * | 1 | Play from hand targeting char           | IMPLEMENTED | play-hazard with targetCharacterId     |
 * | 2 | +2 corruption points while attached     | IMPLEMENTED | stat-modifier corruption-points +2     |
 * | 3 | Untap-end haven corruption check        | IMPLEMENTED | on-event untap-phase-end gated by      |
 * |   |                                         |             | when bearer.atHaven enqueues a         |
 * |   |                                         |             | corruption-check pending resolution    |
 * | 4 | Tap to attempt removal (roll>6)         | IMPLEMENTED | grant-action remove-self-on-roll       |
 * | 5 | Cannot be duplicated on a character     | IMPLEMENTED | duplication-limit scope:character max:1|
 *
 * Playable: YES
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LURE_OF_THE_SENSES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, viableFor, CardStatus, charIdAt, dispatch, expectCharStatus, expectInDiscardPile, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CorruptionCheckAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

describe('Lure of the Senses (tw-60)', () => {
  beforeEach(() => resetMint());


  test('attached Lure adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    // attachHazardToChar bypasses recomputeDerived, so re-derive stats
    // before checking the bearer's effective corruption points.
    const withLure = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES));
    expect(withLure.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(2);
  });

  test('untap → org transition at a haven enqueues a corruption-check pending resolution', () => {
    // Build state in the Untap phase with Aragorn at Rivendell (a haven)
    // and Lure of the Senses already attached, then have the resource
    // player untap and the hazard player pass — the engine should
    // transition to the Organization phase and queue a corruption check.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);

    // Resource player untaps
    const afterUntap = dispatch(withLure, { type: 'untap', player: PLAYER_1 });

    // Hazard player passes — transitions to Organization and triggers
    // the untap-phase-end event for Lure (gated by when bearer.atHaven).
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Lure of the Senses');

    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Legal actions for P1 should collapse to the corruption-check resolution
    const viable = viableFor(afterPass, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');

    const cc = viable[0].action as CorruptionCheckAction;
    // Aragorn has 0 base CP + 2 from Lure = 2; Aragorn's corruptionModifier is 0
    expect(cc.corruptionPoints).toBe(2);
    expect(cc.corruptionModifier).toBe(0);
    expect(cc.need).toBe(3);
  });

  test('untap → org transition at a non-haven does NOT enqueue a corruption check', () => {
    // Aragorn at Moria (a ruins-and-lairs, not a haven). Lure attached
    // but the on-event should not fire because the bearer is not at a haven.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);
    const afterUntap = dispatch(withLure, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('untapped bearer in Organization gets both standard (tap) and no-tap (−3) removal variants', () => {
    // Rule 10.08: untapped bearer gets the standard tap variant AND the no-tap -3 variant.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);
    const actions = viableActions(withLure, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)?.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(7);
  });

  test('successful removal roll (>6) discards Lure and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);
    // Roll 7 succeeds (need > 6)
    const cheated = { ...withLure, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const aragornId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(0);
    // Lure is owned by P2 and goes back to P2's discard pile
    expectInDiscardPile(next, HAZARD_PLAYER, LURE_OF_THE_SENSES);
  });

  test('failed removal roll (<=6) keeps Lure attached but still taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);
    const cheated = { ...withLure, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const aragornId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(LURE_OF_THE_SENSES);
  });
});
