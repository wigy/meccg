/**
 * @module rule-8.32-detainment-attacks
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.32: Detainment Attacks
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * 3.II.1 — If an attack is detainment, no body checks are initiated at the
 * end of its strike sequences, meaning that if the character's modified
 * roll is greater than the strike's prowess, the strike fails without a
 * body check, and if the character's modified roll is less than the
 * strike's prowess, the character is tapped instead of being wounded.
 *
 * 3.II.1.1 — If a strike from a detainment attack is successful, the
 * defending character is not considered to have been wounded and passive
 * conditions that depend on a character being wounded are not initiated.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint,
  executeAction,
  makeDetainmentStrikeState,
  CardStatus, RESOURCE_PLAYER,
} from '../../test-helpers.js';

describe('Rule 8.32 — Detainment Attacks', () => {
  beforeEach(() => resetMint());

  test('3.II.1 — failed strike under detainment taps the character instead of wounding it', () => {
    // Aragorn prowess 9. Strike prowess 15. Roll 3 → total 12 < 15 → wound path.
    const { state, characterId } = makeDetainmentStrikeState({ detainment: true, strikeProwess: 15 });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);

    // Character is tapped, not inverted.
    expect(after.players[RESOURCE_PLAYER].characters[characterId as string].status).toBe(CardStatus.Tapped);
    // No body-check phase entered.
    expect(after.combat?.phase).not.toBe('body-check');
  });

  test('3.II.1 — failed strike under detainment does not enter body-check phase', () => {
    const { state } = makeDetainmentStrikeState({ detainment: true, strikeProwess: 15 });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);
    // Single-strike attack + no body check → combat finalizes directly.
    expect(after.combat).toBeNull();
  });

  test('3.II.1 — non-detainment baseline: failed strike DOES enter character body-check phase', () => {
    // Regression guard: without detainment, the same scenario triggers a
    // character body check (bodyCheckTarget = 'character').
    const { state } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 15 });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);
    expect(after.combat?.phase).toBe('body-check');
    expect(after.combat?.bodyCheckTarget).toBe('character');
  });

  test('3.II.1 — successful strike vs bodied creature still runs creature body-check under detainment', () => {
    // Character roll beats strike prowess; creature has body, so the creature
    // body check must still fire — detainment suppresses only the *character*
    // body check.
    const { state } = makeDetainmentStrikeState({
      detainment: true,
      strikeProwess: 5,
      creatureBody: 9,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);
    expect(after.combat?.phase).toBe('body-check');
    expect(after.combat?.bodyCheckTarget).toBe('creature');
  });

  test('3.II.1 — tied strike under detainment still taps the character (tie behaviour unchanged)', () => {
    // Aragorn prowess 9. Strike prowess 10. Roll 1 → total 10 == 10 → tie.
    // Tap mode: non-wounded tie taps the character.
    const { state, characterId } = makeDetainmentStrikeState({ detainment: true, strikeProwess: 10 });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 1, true);
    expect(after.players[RESOURCE_PLAYER].characters[characterId as string].status).toBe(CardStatus.Tapped);
  });

  test('3.II.1.1 — pre-Inverted character hit by detainment strike is not re-wounded / eliminated and no body check runs', () => {
    // Aragorn starts wounded (Inverted). A detainment strike that would
    // normally trigger elimination via body check must not escalate — under
    // detainment it taps (no-op on already-Tapped/Inverted) and no body
    // check is rolled.
    const { state, characterId } = makeDetainmentStrikeState({
      detainment: true,
      strikeProwess: 15,
      charStatus: CardStatus.Inverted,
    });
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 3, false);

    // Character remains present (not eliminated); no body check phase.
    expect(after.players[RESOURCE_PLAYER].characters[characterId as string]).toBeDefined();
    expect(after.combat).toBeNull();
  });
});
