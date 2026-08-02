/**
 * @module tw-155.test
 *
 * Card test: Gamling the Old (tw-155)
 * Type: hero-character
 *
 * "Unique."
 *
 * Gamling has no special abilities beyond the uniqueness keyword. His card
 * shape (Man warrior, prowess 3, body 7, mind 2, DI 1, MP 0, homesite Edoras)
 * is documented here rather than asserted in tests — verifying JSON against
 * itself would prove nothing. The only rule printed on the card is "Unique.",
 * which the engine enforces via the general uniqueness rule (rule 2.04) in
 * the organization-phase play-character legal-action computation.
 *
 * Rules exercised:
 * 1. Uniqueness — with Gamling already in play for the active hero player,
 *    a second copy of Gamling in hand must not produce a viable
 *    play-character action (engine-level rule 2.04).
 * 2. Uniqueness across players — Gamling in play for one hero player blocks
 *    the other hero player from playing Gamling from hand.
 * 3. Basic playability — with no Gamling in play, a copy of Gamling in hand
 *    produces a viable play-character action at his homesite (Edoras).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, EDORAS,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase } from '../../index.js';

const GAMLING = 'tw-155' as CardDefinitionId;

describe('Gamling the Old (tw-155)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Uniqueness blocks a duplicate in the owner's hand ─────────────

  test('a second Gamling in the same hero player\'s hand is not playable when Gamling is in play', () => {
    // Two Gamlings for the same player: one already at Edoras, another in
    // hand. Uniqueness (rule 2.04) must block the duplicate — no viable
    // play-character action for the hand copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [GAMLING] }],
          hand: [GAMLING],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(0);

    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(blocked.length).toBeGreaterThan(0);
  });

  // ─── Rule 2: Uniqueness is cross-player ────────────────────────────────────

  test('Gamling in play for one hero player blocks the other hero player from playing Gamling', () => {
    // Two hero players. PLAYER_2 has Gamling in play at Lórien; PLAYER_1 has
    // Gamling in hand. Uniqueness applies across players, so PLAYER_1 must
    // not see a viable play-character action for Gamling.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [GAMLING],
          siteDeck: [EDORAS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GAMLING] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(0);

    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(blocked.length).toBeGreaterThan(0);
  });

  // ─── Rule 3: With no Gamling in play, Gamling in hand is viable ────────────

  test('Gamling in hand is viable to play at his homesite (Edoras) when no copy is in play', () => {
    // No Gamling in play; Gamling in hand with Edoras in the site deck.
    // He must produce at least one viable play-character action — and one
    // targeting his homesite Edoras specifically.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [GAMLING],
          siteDeck: [EDORAS, LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);

    // Look up Edoras's instance id in the site deck and confirm at least
    // one viable play targets it (Gamling's homesite).
    const edorasInst = state.players[RESOURCE_PLAYER].siteDeck
      .find(s => s.definitionId === EDORAS);
    expect(edorasInst).toBeDefined();

    const atHomesite = viable.filter(a => a.atSite === edorasInst!.instanceId);
    expect(atHomesite.length).toBeGreaterThan(0);
  });
});
