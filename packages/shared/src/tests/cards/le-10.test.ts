/**
 * @module le-10.test
 *
 * Card test: Eradan (le-10)
 * Type: minion-character
 *
 * "Unique."
 *
 * Eradan has no special abilities beyond the uniqueness keyword. His card
 * shape (Dúnadan scout/ranger, prowess 4, body 8, mind 4, DI 1, MP 1,
 * homesite Sarn Goriwing) is documented here rather than asserted in tests —
 * verifying JSON against itself would prove nothing. The only rule printed
 * on the card is "Unique.", which the engine enforces via the general
 * uniqueness rule (rule 2.04) in the organization-phase play-character
 * legal-action computation.
 *
 * Rules exercised:
 * 1. Uniqueness — with Eradan already in play for the active minion player,
 *    a second copy of Eradan in hand must not produce a viable play-character
 *    action (engine-level rule 2.04).
 * 2. Uniqueness across players — Eradan in play for one minion player
 *    blocks the other minion player from playing Eradan from hand.
 * 3. Basic playability — with no Eradan in play, a copy of Eradan in hand
 *    produces a viable play-character action at his homesite (Sarn Goriwing).
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

const ERADAN = 'le-10' as CardDefinitionId;

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;         // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;       // minion haven
const SARN_GORIWING_MINION = 'le-401' as CardDefinitionId; // Eradan's homesite
const MORIA_MINION = 'le-392' as CardDefinitionId;       // shadow-hold (site-deck filler)

describe('Eradan (le-10)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Uniqueness blocks a duplicate in the owner's hand ─────────────

  test('a second Eradan in the same minion player\'s hand is not playable when Eradan is in play', () => {
    // Two Eradans for the same player: one already at Dol Guldur, another in
    // hand. Uniqueness (rule 2.04) must block the duplicate — no viable
    // play-character action for the hand copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ERADAN] }],
          hand: [ERADAN],
          siteDeck: [MORIA_MINION, SARN_GORIWING_MINION],
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

  test('Eradan in play for one minion player blocks the other minion player from playing Eradan', () => {
    // Two minion players. PLAYER_2 has Eradan in play at Minas Morgul;
    // PLAYER_1 has Eradan in hand. Uniqueness applies across players, so
    // PLAYER_1 must not see a viable play-character action for Eradan.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [ERADAN],
          siteDeck: [MORIA_MINION, SARN_GORIWING_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ERADAN] }],
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

  // ─── Rule 3: With no Eradan in play, Eradan in hand is viable ──────────────

  test('Eradan in hand is viable to play at his homesite (Sarn Goriwing) when no copy is in play', () => {
    // No Eradan in play; Eradan in hand with Sarn Goriwing in the site deck.
    // Since Eradan is mind 4 with base general influence 20 (no other GI
    // usage here), he must produce at least one viable play-character
    // action — and one targeting his homesite Sarn Goriwing specifically.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [ERADAN],
          siteDeck: [SARN_GORIWING_MINION, MORIA_MINION],
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

    // Look up Sarn Goriwing's instance id in the site deck and confirm at
    // least one viable play targets it (Eradan's homesite).
    const sarnGoriwingInst = state.players[RESOURCE_PLAYER].siteDeck
      .find(s => s.definitionId === SARN_GORIWING_MINION);
    expect(sarnGoriwingInst).toBeDefined();

    const atHomesite = viable.filter(a => a.atSite === sarnGoriwingInst!.instanceId);
    expect(atHomesite.length).toBeGreaterThan(0);
  });
});
