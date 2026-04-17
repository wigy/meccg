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
  getHazardsOn,
  grantedActionsFor,
  PLAYER_1,
  resetMint,
  setCharStatus,
} from '../../test-helpers.js';

const PLAYER_1_IDX = 0;

describe('METD §7 / Rule 10.08 — Corruption no-tap variant', () => {
  beforeEach(() => resetMint());

  test('untapped bearer gets both standard and no-tap variants', () => {
    const state = attachHazardToChar(buildSimpleTwoPlayerState(), PLAYER_1_IDX, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = findCharInstanceId(state, PLAYER_1_IDX, ARAGORN);

    const acts = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(acts).toHaveLength(2);
    expect(acts.filter(a => a.noTap === true)).toHaveLength(1);
    expect(acts.filter(a => a.noTap !== true)).toHaveLength(1);
  });

  test('tapped bearer gets only the no-tap variant (standard requires untapped)', () => {
    let state = attachHazardToChar(buildSimpleTwoPlayerState(), PLAYER_1_IDX, ARAGORN, ALONE_AND_UNADVISED);
    state = setCharStatus(state, PLAYER_1_IDX, ARAGORN, CardStatus.Tapped);
    const aragornId = findCharInstanceId(state, PLAYER_1_IDX, ARAGORN);

    const acts = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(acts).toHaveLength(1);
    expect(acts[0].noTap).toBe(true);
  });

  test('once locked, NEITHER variant is offered for the same character+card', () => {
    let state = attachHazardToChar(buildSimpleTwoPlayerState(), PLAYER_1_IDX, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = findCharInstanceId(state, PLAYER_1_IDX, ARAGORN);
    const corruptionId = getHazardsOn(state, PLAYER_1_IDX, ARAGORN)[0].instanceId;
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

    expect(grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);
  });
});
