/**
 * @module td-130.test
 *
 * Card test: Magical Harp (td-130)
 * Type: hero-resource-item (major, hoard)
 *
 * Printed text:
 *   "Unique. Hoard item. Tap Magical Harp to cancel all effects for the
 *    rest of the turn that discard a target character in bearer's
 *    company. Bearer makes a corruption check. This item may also be so
 *    tapped during opponent's site phase or the Free Council."
 *
 * Rule coverage (see PR description for the full NOT CERTIFIED rationale):
 *
 * | # | Rule                                               | Status              |
 * |---|----------------------------------------------------|---------------------|
 * | 1 | Unique — one copy of this card may be in play      | IMPLEMENTED (test)  |
 * | 2 | Hoard item — playable only at hoard sites          | IMPLEMENTED (test)  |
 * | 3 | Tap to cancel character-discard effects for the    | NOT IMPLEMENTED     |
 * |   | rest of the turn against bearer's company          |                     |
 * | 4 | Bearer makes a corruption check after tap          | NOT IMPLEMENTED     |
 * | 5 | May also be tapped during opponent's site phase    | NOT IMPLEMENTED     |
 * |   | or the Free Council                                |                     |
 *
 * Rules 3–5 require new engine infrastructure: a grant-action that cancels
 * character-discard effects turn-wide (no `cancel-discard` DSL effect
 * exists today), a corruption-check follow-up tied to that activation,
 * and a timing model that lets an in-play item activate during the
 * opponent's site phase or the Free Council phase. None of that
 * infrastructure exists yet, so the activated ability cannot be
 * certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  GANDALF, SARUMAN,
  MORIA, LORIEN,
  resetMint,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const MAGICAL_HARP = 'td-130' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard site

describe('Magical Harp (td-130)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 1: Uniqueness ──────────────────────────────────────────────────

  test('second copy of Magical Harp is NOT playable while another is in play', () => {
    // One copy already attached to Gandalf; a second copy in hand must not
    // be offered as a resource play — neither to Gandalf nor to Saruman.
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [MAGICAL_HARP] },
        SARUMAN,
      ],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const viable = plays.filter(ea => ea.viable);
    expect(viable).toHaveLength(0);
  });

  test('first copy of Magical Harp is playable on an unburdened bearer', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const gandalfId = Object.values(state.players[0].characters)
      .find(c => c.definitionId === GANDALF)!.instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeDefined();
  });

});
