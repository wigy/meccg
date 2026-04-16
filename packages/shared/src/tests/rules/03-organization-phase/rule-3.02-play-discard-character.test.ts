/**
 * @module rule-3.02-play-discard-character
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.02: Play or Discard a Character
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Organizing by Playing (or Discarding) a Character - The resource player may play or discard a character while organizing during the organization phase. This action can only be taken once per turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { OrganizationPhaseState } from '../../../index.js';

describe('Rule 3.02 — Play or Discard a Character', () => {
  beforeEach(() => resetMint());

  test('Resource player may play one character; a second play in the same turn is not viable', () => {
    // P1 holds Aragorn and Bilbo, both legally playable at Rivendell
    // (Aragorn as a haven play, Bilbo at his Shire homesite would be
    // unavailable so we use Rivendell for both — Bilbo's mind 1 fits
    // anywhere via DI on a haven; the engine still gates by once-per-turn).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN, BILBO],
          siteDeck: [RIVENDELL],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    // Initial: at least one play is viable, characterPlayedThisTurn is false.
    expect((state.phaseState as OrganizationPhaseState).characterPlayedThisTurn).toBe(false);
    const initialViable = viablePlayCharacterActions(state, PLAYER_1);
    expect(initialViable.length).toBeGreaterThan(0);

    // Play one character (the first viable option).
    const afterPlay = dispatch(state, initialViable[0]);
    expect((afterPlay.phaseState as OrganizationPhaseState).characterPlayedThisTurn).toBe(true);

    // Now the remaining hand character is offered only as non-viable
    // with an "already played a character this turn" reason.
    const stillViable = viablePlayCharacterActions(afterPlay, PLAYER_1);
    expect(stillViable).toHaveLength(0);

    const blocked = nonViablePlayCharacterActions(afterPlay, PLAYER_1);
    expect(blocked.length).toBeGreaterThan(0);
  });

  test('Hazard player cannot play characters during the organization phase', () => {
    // Only the resource (active) player may play a character while
    // organizing. The hazard player has Bilbo in hand but no viable
    // play-character action is offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [RIVENDELL],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [BILBO],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_2)).toHaveLength(0);
  });
});
