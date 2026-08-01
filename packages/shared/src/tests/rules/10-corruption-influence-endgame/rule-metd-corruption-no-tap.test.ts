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
 *
 * Rule 7.3 also withholds the no-tap variant itself once a standard
 * tap-and-roll attempt has already been made this turn on the same
 * character+corruption-card pair — the no-tap declaration is only
 * available as the *first* attempt of the turn. Rule 7.3.1 still
 * permits repeat tap-and-roll attempts (e.g. if the character is
 * untapped again) as long as the no-tap variant hasn't been used.
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
  reduce,
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

  test('rule 7.3: a tap-and-roll attempt withholds the no-tap variant for the rest of the turn', () => {
    const state = attachHazardToChar(buildSimpleTwoPlayerState(), PLAYER_1_IDX, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = findCharInstanceId(state, PLAYER_1_IDX, ARAGORN);
    const corruptionId = getHazardsOn(state, PLAYER_1_IDX, ARAGORN)[0].instanceId;

    const tapAction = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1)
      .find(a => a.noTap !== true);
    expect(tapAction).toBeDefined();

    // Force the roll to fail (below the threshold of 7) so the corruption
    // card survives the attempt — the bug is specifically about what
    // happens next, regardless of the roll's own outcome.
    const afterTap = reduce({ ...state, cheatRollTotal: 2 }, tapAction!);
    expect(getHazardsOn(afterTap.state, PLAYER_1_IDX, ARAGORN)).toHaveLength(1);

    // Rule 7.3: the no-tap -3 variant "cannot be taken if an attempt to
    // remove the same corruption card has already been made this turn."
    // Only the tap-and-roll variant remains legal (rule 7.3.1 allows
    // repeat tap attempts if the character is untapped again).
    const actsAfterTap = grantedActionsFor(afterTap.state, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(actsAfterTap.filter(a => a.noTap === true)).toHaveLength(0);

    // Untapping the character re-offers the standard variant but the
    // no-tap variant remains withheld — the lock isn't merely "bearer is
    // tapped," it's a per-turn attempt record.
    const untapped = setCharStatus(afterTap.state, PLAYER_1_IDX, ARAGORN, CardStatus.Untapped);
    const actsAfterUntap = grantedActionsFor(untapped, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(actsAfterUntap.filter(a => a.noTap === true)).toHaveLength(0);
    expect(actsAfterUntap.filter(a => a.noTap !== true)).toHaveLength(1);

    expect(afterTap.state.activeConstraints.some(c =>
      c.kind.type === 'corruption-removal-attempted'
      && c.kind.characterId === aragornId
      && c.kind.corruptionInstanceId === corruptionId,
    )).toBe(true);
  });
});
