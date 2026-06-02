/**
 * @module le-174.test
 *
 * Card test: By the Ringwraith's Word (le-174)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable during the organization phase on one of your other characters
 *    at the same Darkhaven [{DH}] as your Ringwraith. The character: becomes
 *    a leader (if not already), receives +4 direct influence against
 *    characters in his company, and cannot be discarded by a body check.
 *    Discard at any time if there is a character in his company with a
 *    higher mind. Cannot be duplicated by a given player. Cannot be included
 *    in a Balrog's deck."
 *
 * Engine Support:
 * | # | Rule                                                           | Status          |
 * |---|----------------------------------------------------------------|-----------------|
 * | 1 | Playable during organization phase on non-Ringwraith character | IMPLEMENTED     |
 * | 2 | Playability gated on target being at same Darkhaven as the    | IMPLEMENTED     |
 * |   | controller's Ringwraith                                        |                 |
 * | 3 | Target character becomes a leader (if not already)             | NOT IMPLEMENTED |
 * | 4 | +4 direct influence for the bearer against characters in his  | NOT IMPLEMENTED |
 * |   | own company                                                    |                 |
 * | 5 | Bearer cannot be discarded by a body check                     | NOT IMPLEMENTED |
 * | 6 | Auto-discard while a character in bearer's company has a       | NOT IMPLEMENTED |
 * |   | higher mind than the bearer                                    |                 |
 * | 7 | Cannot be duplicated by a given player (per-player copy limit) | IMPLEMENTED     |
 * | 8 | Cannot be included in a Balrog's deck (deck construction)      | OUT OF SCOPE    |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  getItemsOn,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** By the Ringwraith's Word — the card under test */
const BY_THE_RINGWRAITHS_WORD = 'le-174' as CardDefinitionId;
/** Adûnaphel the Ringwraith — a ringwraith-race character (le-50) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** The Mouth — a non-ringwraith minion character (le-24) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Ciryaher — a non-ringwraith minion character (le-6) */
const CIRYAHER = 'le-6' as CardDefinitionId;
/** Dol Guldur — a minion haven site (le-367) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
/** Ettenmoors — a minion ruins-and-lairs site (not a haven) */
const ETTENMOORS = 'le-373' as CardDefinitionId;
/** Hoarmurath the Ringwraith — a second ringwraith for player 2 (le-53) */
const HOARMURATH = 'le-53' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function orgStateAtHaven(opts: {
  targetSite?: CardDefinitionId;
  targetChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  cardsInPlay?: import('../../index.js').CardInPlay[];
}) {
  const targetSite = opts.targetSite ?? DOL_GULDUR;
  const targetChars = opts.targetChars ?? [THE_MOUTH];
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [
          { site: DOL_GULDUR, characters: [ADUNAPHEL] },
          { site: targetSite, characters: targetChars },
        ],
        hand: opts.hand ?? [BY_THE_RINGWRAITHS_WORD],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
        cardsInPlay: opts.cardsInPlay ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('By the Ringwraith\'s Word (le-174)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: Playability ───────────────────────────────────────────────

  test('playable during organization phase on a non-Ringwraith character at a Darkhaven', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const action = actions[0].action as { targetCharacterId?: unknown };
    expect(action.targetCharacterId).toBe(mouthId);
  });

  test('playable on each qualifying non-Ringwraith character when multiple are at a Darkhaven', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH, CIRYAHER] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(2);
  });

  test('NOT playable if the target character\'s company is not at a Darkhaven (ruins-and-lairs)', () => {
    const state = orgStateAtHaven({ targetSite: ETTENMOORS, targetChars: [THE_MOUTH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable on the Ringwraith itself ("one of your OTHER characters")', () => {
    // Company with only the Ringwraith at a haven — should not be offered as a target
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 7: Player duplication limit ─────────────────────────────────────

  test('a player cannot play a second copy while one is already in play under their control', () => {
    const base = orgStateAtHaven({ targetChars: [THE_MOUTH], hand: [BY_THE_RINGWRAITHS_WORD, BY_THE_RINGWRAITHS_WORD] });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, BY_THE_RINGWRAITHS_WORD);
    const targetId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);
    const afterFirst = playPermanentEventAndResolve(base, PLAYER_1, cardId, targetId);
    // After the first copy is attached, the second should not be viable
    const actions = viableActions(afterFirst, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Resolved: card attaches to the target character ──────────────────────

  test('when played, card is attached to the target character as an item', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, BY_THE_RINGWRAITHS_WORD);
    const targetId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, targetId);
    const items = getItemsOn(after, RESOURCE_PLAYER, THE_MOUTH);
    expect(items.some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);
  });

  // ── Unimplemented rules ───────────────────────────────────────────────────

  test('NOT playable if the controller\'s Ringwraith is not at the same Darkhaven as the target', () => {
    // Company has only non-ringwraith characters at a haven; no ringwraith anywhere at that haven
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH, CIRYAHER] }],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });
  test.todo('while attached, the bearer counts as a leader even if the base character has no leader skill');
  test.todo('while attached, the bearer gets +4 direct influence against characters in his own company');
  test.todo('+4 DI does not apply when the bearer targets a character outside his own company');
  test.todo('while attached, a failed body check on the bearer does NOT eliminate him');
  test.todo('the bearer card is auto-discarded when a company-mate has a higher mind than the bearer');
  test.todo('the bearer card stays in play while no company-mate has a higher mind than the bearer');
  test.todo('the opposing Ringwraith player may still play their own copy while one is in play under the other player');
});
