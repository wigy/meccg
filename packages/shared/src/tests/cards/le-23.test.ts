/**
 * @module le-23.test
 *
 * Card test: Luitprand (le-23)
 * Type: minion-character
 *
 * "Unique."
 *
 * Luitprand has no special abilities beyond the uniqueness keyword. His card
 * shape (Man scout, prowess 3, body 7, mind 1, DI 0, MP 0, homesite
 * Lake-town) is documented here rather than asserted in tests — verifying
 * JSON against itself would prove nothing. The only rule printed on the
 * card is "Unique.", which the engine enforces via the general uniqueness
 * rule (rule 2.04) in the organization-phase play-character legal-action
 * computation.
 *
 * Note: Luitprand's homesite (Lake-town) is a hero site and has no minion
 * counterpart in the current card pool. A minion player therefore cannot
 * play Luitprand at his homesite — only at a minion haven. The playability
 * test below asserts that Luitprand in hand produces a viable play-character
 * action targeting a minion haven (Dol Guldur) when no copy is in play.
 *
 * Rules exercised:
 * 1. Uniqueness — with Luitprand already in play for the active minion
 *    player, a second copy of Luitprand in hand must not produce a viable
 *    play-character action (engine-level rule 2.04).
 * 2. Uniqueness across players — Luitprand in play for one minion player
 *    blocks the other minion player from playing Luitprand from hand.
 * 3. Basic playability — with no Luitprand in play, a copy of Luitprand in
 *    hand produces a viable play-character action at a minion haven.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion
 * sites (LE) and Alignment.Ringwraith for the minion player(s).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  RESOURCE_PLAYER,
  ARAGORN, RIVENDELL,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Alignment, Phase } from '../../index.js';

const LUITPRAND = 'le-23' as CardDefinitionId;

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (site-deck filler)

describe('Luitprand (le-23)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Uniqueness blocks a duplicate in the owner's hand ─────────────

  test('a second Luitprand in the same minion player\'s hand is not playable when Luitprand is in play', () => {
    // Two Luitprands for the same player: one already at Dol Guldur, another
    // in hand. Uniqueness (rule 2.04) must block the duplicate — no viable
    // play-character action for the hand copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
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

  test('Luitprand in play for one minion player blocks the other minion player from playing Luitprand', () => {
    // Two minion players. PLAYER_2 has Luitprand in play at Minas Morgul;
    // PLAYER_1 has Luitprand in hand. Uniqueness applies across players, so
    // PLAYER_1 must not see a viable play-character action for Luitprand.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(0);

    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(blocked.length).toBeGreaterThan(0);
  });

  // ─── Rule 3: With no Luitprand in play, Luitprand in hand is viable ────────

  test('Luitprand in hand is viable to play at a minion haven when no copy is in play', () => {
    // No Luitprand in play; Luitprand (mind 1) in hand. His homesite
    // Lake-town has no minion counterpart in the pool, but as a mind-1
    // character with base general influence 20 he must be playable at any
    // minion haven — Dol Guldur is the company's current site.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);

    // Confirm at least one viable play targets the minion haven Dol Guldur.
    const dolGuldurInst = state.players[RESOURCE_PLAYER].companies[0]?.currentSite;
    expect(dolGuldurInst).toBeDefined();

    const atDolGuldur = viable.filter(a => a.atSite === dolGuldurInst!.instanceId);
    expect(atDolGuldur.length).toBeGreaterThan(0);
  });
});
