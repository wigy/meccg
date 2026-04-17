/**
 * @module rule-metd-corruption-no-tap
 *
 * METD §7 / CRF rule 10.08 — Corruption-card removal no-tap variant.
 *
 * A character may ignore the "must tap" restriction printed on a
 * corruption card and instead suffer -3 to the removal roll. The no-tap
 * attempt is allowed even if the character is already tapped or
 * wounded. After ANY no-tap attempt is made, no further attempts
 * (tap or no-tap) on the same character+corruption-card pair may be
 * made for the rest of the turn. The lock clears on next untap.
 */

import { describe, expect, test, beforeEach } from 'vitest';
import {
  ALONE_AND_UNADVISED,
  ARAGORN,
  attachHazardToChar,
  buildSimpleTwoPlayerState,
  CardStatus,
  findCharInstanceId,
  PLAYER_1,
  resetMint,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { ActivateGrantedAction } from '../../../index.js';

function setCharStatus(state: ReturnType<typeof buildSimpleTwoPlayerState>, charId: string, status: CardStatus) {
  const player = state.players[0];
  const char = player.characters[charId];
  return {
    ...state,
    players: [
      { ...player, characters: { ...player.characters, [charId]: { ...char, status } } },
      state.players[1],
    ] as typeof state.players,
  };
}

describe('METD §7 / Rule 10.08 — Corruption no-tap variant', () => {
  beforeEach(() => resetMint());

  test('emitter offers BOTH the standard tap and the no-tap variant', () => {
    const state = attachHazardToChar(
      buildSimpleTwoPlayerState(),
      0,
      ARAGORN,
      ALONE_AND_UNADVISED,
    );
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const acts = computeLegalActions(state, PLAYER_1)
      .map(ea => ea.action)
      .filter((a): a is ActivateGrantedAction =>
        a.type === 'activate-granted-action'
        && a.characterId === aragornId
        && a.actionId === 'remove-self-on-roll');
    // Two variants: standard (tap) and no-tap.
    expect(acts.length).toBe(2);
    expect(acts.filter(a => a.noTap === true)).toHaveLength(1);
    expect(acts.filter(a => a.noTap !== true)).toHaveLength(1);
  });

  test('no-tap variant is offered even when the character is already tapped', () => {
    let state = attachHazardToChar(buildSimpleTwoPlayerState(), 0, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    state = setCharStatus(state, aragornId as string, CardStatus.Tapped);
    const acts = computeLegalActions(state, PLAYER_1)
      .map(ea => ea.action)
      .filter((a): a is ActivateGrantedAction =>
        a.type === 'activate-granted-action'
        && a.characterId === aragornId
        && a.actionId === 'remove-self-on-roll');
    // Only the no-tap variant — standard requires the bearer untapped.
    expect(acts).toHaveLength(1);
    expect(acts[0].noTap).toBe(true);
  });

  test('once locked, NEITHER variant is offered for the same character+card', () => {
    // Build an untapped Aragorn with the corruption card, manually
    // inject the lock constraint, and expect no remove-self-on-roll
    // actions to be emitted for that pair.
    let state = attachHazardToChar(buildSimpleTwoPlayerState(), 0, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const corruptionId = state.players[0].characters[aragornId as string].hazards[0].instanceId;
    state = {
      ...state,
      activeConstraints: [
        ...state.activeConstraints,
        {
          id: 'test-lock-1' as never,
          source: corruptionId,
          sourceDefinitionId: ALONE_AND_UNADVISED,
          scope: { kind: 'turn' },
          target: { kind: 'character', characterId: aragornId },
          kind: { type: 'corruption-removal-locked', characterId: aragornId, corruptionInstanceId: corruptionId },
        },
      ],
    };
    const acts = computeLegalActions(state, PLAYER_1)
      .map(ea => ea.action)
      .filter((a): a is ActivateGrantedAction =>
        a.type === 'activate-granted-action'
        && a.characterId === aragornId
        && a.actionId === 'remove-self-on-roll');
    expect(acts).toHaveLength(0);
  });
});
