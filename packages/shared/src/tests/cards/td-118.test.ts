/**
 * @module td-118.test
 *
 * Card test: Gift of Comprehension (td-118)
 * Type: hero-resource-event (permanent)
 * Marshalling points: 0
 * Effects:
 *   1. play-target — character, filter Dúnadan race AND untapped
 *   2. play-condition — site-type, siteTypes: ["haven"]
 *   3. play-flag — tap-character-on-play
 *   4. grant-skill — sage
 *
 * Text:
 *   "Playable on a Dúnadan at a Haven [{H}]; tap the Dúnadan. Gives the
 *    bearer sage skill."
 *
 * | # | Rule                                          | Status |
 * |---|------------------------------------------------|--------|
 * | 1 | Playable on a Dúnadan (race gate)               | OK     |
 * | 2 | Only at a Haven [{H}]                            | OK     |
 * | 3 | Only on an untapped Dúnadan                      | OK     |
 * | 4 | Tap the Dúnadan on play                          | OK     |
 * | 5 | Attaches to the Dúnadan                          | OK     |
 * | 6 | Gives the bearer sage skill                      | OK     |
 *
 * Playable: YES — CERTIFIED.
 *
 * Character selection: ARAGORN (tw-120) is a Dúnadan without the sage skill
 * (warrior/scout/ranger), so he's used both as the positive-race target and
 * to prove the granted sage skill via When You Know More (dm-163), a
 * sage-only permanent event that is otherwise unplayable on him.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, RESOURCE_PLAYER,
  CardStatus,
  buildSitePhaseState, attachItemToChar,
  resetMint, findCharInstanceId,
  dispatch, resolveChain, viableActions, setCharStatus,
  ARAGORN, LEGOLAS, RIVENDELL, PELARGIR,
} from '../test-helpers.js';

const GIFT_OF_COMPREHENSION = 'td-118' as CardDefinitionId;
const WHEN_YOU_KNOW_MORE = 'dm-163' as CardDefinitionId; // sage-only permanent event
const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable

describe('Gift of Comprehension (td-118)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1-3: playable on an untapped Dúnadan at a Haven ─────────────────

  test('offered as a permanent event on an untapped Dúnadan at a Haven', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: RIVENDELL,
      hand: [GIFT_OF_COMPREHENSION],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-Dúnadan character', () => {
    const state = buildSitePhaseState({
      characters: [LEGOLAS], // elf
      site: RIVENDELL,
      hand: [GIFT_OF_COMPREHENSION],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered at a non-Haven site', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR, // free-hold
      hand: [GIFT_OF_COMPREHENSION],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered on a tapped Dúnadan', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: RIVENDELL,
      hand: [GIFT_OF_COMPREHENSION],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Rules 4+5: tap the Dúnadan on play and attach to him ──────────────────

  test('playing it taps the Dúnadan and attaches the card to him', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: RIVENDELL,
      hand: [GIFT_OF_COMPREHENSION],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.status).toBe(CardStatus.Tapped);
    expect(aragorn.items.some(i => i.definitionId === GIFT_OF_COMPREHENSION)).toBe(true);
  });

  // ── Rule 6: gives the bearer sage skill ───────────────────────────────────

  test('gives the bearer sage skill, making a sage-only permanent event playable', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: AMON_HEN,
      hand: [WHEN_YOU_KNOW_MORE],
    });
    // Before: Aragorn (warrior/scout/ranger) is not a sage.
    expect(viableActions(base, PLAYER_1, 'play-permanent-event')).toHaveLength(0);

    // After: attach Gift of Comprehension directly (bypassing its own play
    // conditions, which is fine — this test isolates the skill-grant effect).
    const withGift = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GIFT_OF_COMPREHENSION);
    expect(viableActions(withGift, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });
});
