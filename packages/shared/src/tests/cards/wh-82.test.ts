/**
 * @module wh-82.test
 *
 * Card test: Thrall of the Voice (wh-82)
 * Type: hero-resource-event (permanent, fallen-wizard alignment)
 *
 * Card text:
 *   "Instead of a normal character, during your organization phase you may
 *    bring into play one character (including a minion agent) with up to a 6
 *    mind. Place this card with the character. -1 to his mind to a minimum of
 *    1. Such a character may also be in your starting company."
 *
 * The CRF/French printing adds the clarifying clauses: the special play counts
 * against the one-character-per-turn limit, and the card "cannot be used to
 * include a character that cannot be included in a starting company, nor to
 * allow a Fallen-wizard player to bring an Orc or Troll character into play
 * without an appropriate card".
 *
 * | # | Rule                                                          | Status          |
 * |---|---------------------------------------------------------------|-----------------|
 * | 1 | Recruit a character (incl. minion agent, mind ≤ 6) via this    | NOT IMPLEMENTED |
 * |   | card instead of a normal character, within the 1/turn limit   |                 |
 * | 2 | Place this card with the recruited character                  | NOT IMPLEMENTED |
 * | 3 | -1 to the borne character's mind, to a minimum of 1           | IMPLEMENTED     |
 * | 4 | Such a character may also be in your starting company         | NOT IMPLEMENTED |
 *
 * ⚠️ NOT CERTIFIED. The core mechanic — a resource-event "recruitment vehicle"
 * that brings an otherwise-ineligible character (a minion agent, or any
 * character up to 6 mind) into play for a Fallen-wizard player, consuming the
 * one-character-per-turn slot, and permits that character in the starting
 * company — has no DSL effect type and no engine support. There is no
 * legal-action path that plays this event as a character-recruitment, and the
 * character-deck-draft / setup phase has no mechanism to admit such a character
 * into a starting company. Implementing rules 1, 2, and 4 requires an
 * engine-wide feature (a new effect type plus changes to organization-phase
 * legal-action generation and the draft/setup pipeline) well beyond a
 * single-card certification.
 *
 * Only rule 3 (the mind reduction) is expressible today: a `stat-modifier`
 * with `stat: "mind"` whose value expression reduces the bearer's mind by one
 * but never below one. It is resolved by `recomputeDerived` as the borne
 * character's general-influence control cost, exactly as for the certified
 * troll-triplet mind reductions (as-1/as-5/as-6). This test exercises that
 * rule by attaching the card to a character and recomputing derived stats.
 *
 * Playable: PARTIALLY (mind reduction only; recruitment mechanic unsupported)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, getCharacter,
  recomputeDerived,
  Phase, Alignment, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId;
const IVIC = 'dm-17' as CardDefinitionId;         // minion agent, mind 6 (→ 5)
const BILL_FERNY = 'dm-3' as CardDefinitionId;     // minion agent, mind 3 (→ 2)
const ORC_BRAWLER = 'le-30' as CardDefinitionId;   // minion character, mind 1 (→ floor 1)
const AMON_HEN = 'tw-371' as CardDefinitionId;     // a Ruins & Lairs
const RIVENDELL = 'tw-421' as CardDefinitionId;
const OPPONENT_CHAR = 'tw-155' as CardDefinitionId; // Gamling the Old — opponent filler

/**
 * Build a Fallen-wizard company holding `charDef`, attach Thrall of the Voice
 * to that character, recompute derived stats, and return the resulting state.
 */
function thrallAttachedState(charDef: CardDefinitionId) {
  let state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: AMON_HEN, characters: [charDef] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
  state = attachItemToChar(state, RESOURCE_PLAYER, charDef, THRALL_OF_THE_VOICE);
  return recomputeDerived(state);
}

describe('Thrall of the Voice (wh-82)', () => {
  beforeEach(() => resetMint());

  // ── Rule 3: -1 to the borne character's mind ────────────────────────────────

  test('reduces a mind-6 agent to an effective mind of 5', () => {
    const state = thrallAttachedState(IVIC);
    expect(getCharacter(state, RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBe(5);
  });

  test('reduces a mind-3 character to an effective mind of 2', () => {
    const state = thrallAttachedState(BILL_FERNY);
    expect(getCharacter(state, RESOURCE_PLAYER, BILL_FERNY).effectiveStats.mind).toBe(2);
  });

  // ── Rule 3: "to a minimum of 1" floor ───────────────────────────────────────

  test('does not reduce a mind-1 character below 1', () => {
    const state = thrallAttachedState(ORC_BRAWLER);
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_BRAWLER).effectiveStats.mind).toBe(1);
  });

  // ── Sanity: with the card detached the mind is unmodified ────────────────────

  test('mind is unmodified when the card is not attached', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: AMON_HEN, characters: [IVIC] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    // No mind stat-modifier fires, so effectiveStats.mind is left undefined.
    expect(getCharacter(state, RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBeUndefined();
  });
});
