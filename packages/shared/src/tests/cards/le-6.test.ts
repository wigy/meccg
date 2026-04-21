/**
 * @module le-6.test
 *
 * Card test: Ciryaher (le-6)
 * Type: minion-character (ringwraith alignment).
 * Stats: Dúnadan scout/sage, prowess 2, body 7, mind 5, DI 2, MP 2,
 * homesite Barad-dûr (le-352).
 *
 * Card text:
 *   "Unique. Can use shadow-magic."
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                                                   |
 * |---|------------------------------------|-------------|---------------------------------------------------------|
 * | 1 | Uniqueness                         | IMPLEMENTED | Enforced by rule 2.04 in play-character legal actions   |
 * | 2 | Can use shadow-magic               | FLAVOR      | No certified shadow-magic consumer in the pool; latent  |
 *
 * The "Can use shadow-magic" text is a latent permission: it grants
 * Ciryaher the property of being a shadow-magic-using character so that
 * shadow-magic resources (e.g. as-40 Well-preserved, le-212) may be played
 * on/with him. No shadow-magic resource is currently certified or wired
 * into the engine, so the permission is not exercised today — it is
 * documented here alongside the same "FLAVOR" treatment used for le-50
 * Adûnaphel the Ringwraith's "Can use spirit-magic" clause.
 *
 * Playable: YES.
 *
 * Rules exercised:
 * 1. Uniqueness — a second Ciryaher in hand produces no viable
 *    play-character action while one is already in play (rule 2.04).
 * 2. Uniqueness across players — Ciryaher in play for one minion player
 *    blocks the other minion player from playing Ciryaher from hand.
 * 3. Basic playability — with no Ciryaher in play, a copy in hand is a
 *    viable play-character action at his homesite (Barad-dûr).
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

const CIRYAHER = 'le-6' as CardDefinitionId;

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // minion haven
const BARAD_DUR = 'le-352' as CardDefinitionId;       // Ciryaher's homesite (dark-hold)
const MORIA_MINION = 'le-392' as CardDefinitionId;    // shadow-hold (site-deck filler)

describe('Ciryaher (le-6)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Uniqueness blocks a duplicate in the owner's hand ─────────────

  test('a second Ciryaher in the same minion player\'s hand is not playable when Ciryaher is in play', () => {
    // Two Ciryahers for the same player: one already at Dol Guldur, another
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
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
          hand: [CIRYAHER],
          siteDeck: [MORIA_MINION, BARAD_DUR],
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

  test('Ciryaher in play for one minion player blocks the other minion player from playing Ciryaher', () => {
    // Two minion players. PLAYER_2 has Ciryaher in play at Minas Morgul;
    // PLAYER_1 has Ciryaher in hand. Uniqueness applies across players, so
    // PLAYER_1 must not see a viable play-character action for Ciryaher.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [CIRYAHER],
          siteDeck: [MORIA_MINION, BARAD_DUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }],
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

  // ─── Rule 3: With no Ciryaher in play, Ciryaher in hand is viable ──────────

  test('Ciryaher in hand is viable to play at his homesite (Barad-dûr) when no copy is in play', () => {
    // No Ciryaher in play; Ciryaher in hand with Barad-dûr in the site deck.
    // Mind 5 is well below the 20 starting GI, so uniqueness is the only
    // gate — Ciryaher must produce at least one viable play-character
    // action, and at least one targeting his homesite Barad-dûr.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [CIRYAHER],
          siteDeck: [BARAD_DUR, MORIA_MINION],
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

    // Look up Barad-dûr's instance id in the site deck and confirm at
    // least one viable play targets it (Ciryaher's homesite).
    const baradDurInst = state.players[RESOURCE_PLAYER].siteDeck
      .find(s => s.definitionId === BARAD_DUR);
    expect(baradDurInst).toBeDefined();

    const atHomesite = viable.filter(a => a.atSite === baradDurInst!.instanceId);
    expect(atHomesite.length).toBeGreaterThan(0);
  });
});
