/**
 * @module tw-060.test
 *
 * Card test: Lure of the Senses (tw-60)
 * Type: hazard-event (permanent, character-targeting corruption hazard)
 * Effects: 5 (play-target character, duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event untap-phase-at-haven force-check corruption,
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
 * | 3 | Untap-end haven corruption check        | IMPLEMENTED | on-event untap-phase-at-haven enqueues |
 * |   |                                         |             | a corruption-check pending resolution  |
 * | 4 | Tap to attempt removal (roll>6)         | IMPLEMENTED | grant-action remove-self-on-roll       |
 * | 5 | Cannot be duplicated on a character     | IMPLEMENTED | duplication-limit scope:character max:1|
 *
 * Playable: YES
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LURE_OF_THE_SENSES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, pool,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CorruptionCheckAction, HazardEventCard } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

describe('Lure of the Senses (tw-60)', () => {
  beforeEach(() => resetMint());

  test('card definition has the expected effects array', () => {
    const def = pool[LURE_OF_THE_SENSES as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('permanent');
    expect(def.effects).toBeDefined();

    const types = def.effects!.map(e => e.type);
    expect(types).toContain('play-target');
    expect(types).toContain('duplication-limit');
    expect(types).toContain('stat-modifier');
    expect(types).toContain('on-event');
    expect(types).toContain('grant-action');

    const onEvent = def.effects!.find(e => e.type === 'on-event');
    expect(onEvent).toMatchObject({
      type: 'on-event',
      event: 'untap-phase-at-haven',
      apply: { type: 'force-check', check: 'corruption' },
    });

    const cpMod = def.effects!.find(
      e => e.type === 'stat-modifier' && (e as { stat: string }).stat === 'corruption-points',
    );
    expect(cpMod).toMatchObject({ type: 'stat-modifier', stat: 'corruption-points', value: 2 });
  });

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

    const aragornId = base.players[0].companies[0].characters[0];
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    // attachHazardToChar bypasses recomputeDerived, so re-derive stats
    // before checking the bearer's effective corruption points.
    const withLure = recomputeDerived(attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES));
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

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);

    // Resource player untaps
    const afterUntap = reduce(withLure, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.error).toBeUndefined();

    // Hazard player passes — transitions to Organization and triggers
    // the untap-phase-at-haven event for Lure.
    const afterPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.error).toBeUndefined();
    expect(afterPass.state.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Lure of the Senses');

    const aragornId = afterPass.state.players[0].companies[0].characters[0];
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Legal actions for P1 should collapse to the corruption-check resolution
    const actions = computeLegalActions(afterPass.state, PLAYER_1);
    const viable = actions.filter(a => a.viable);
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

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    const afterUntap = reduce(withLure, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.error).toBeUndefined();
    const afterPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.error).toBeUndefined();
    expect(afterPass.state.phaseState.phase).toBe(Phase.Organization);

    expect(afterPass.state.pendingResolutions).toHaveLength(0);
  });

  test('untapped bearer in Organization can activate remove-self-on-roll (rollThreshold 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    const actions = viableActions(withLure, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(7);
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

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Roll 7 succeeds (need > 6)
    const cheated = { ...withLure, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(0);
    // Lure is owned by P2 and goes back to P2's discard pile
    expect(result.state.players[1].discardPile.some(c => c.definitionId === LURE_OF_THE_SENSES)).toBe(true);
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

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    const cheated = { ...withLure, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(result.state.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(LURE_OF_THE_SENSES);
  });
});
