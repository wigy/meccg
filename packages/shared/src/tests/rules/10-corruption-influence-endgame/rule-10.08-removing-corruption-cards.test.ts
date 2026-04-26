/**
 * @module rule-10.08-removing-corruption-cards
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.08: Removing Corruption Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When attempting to remove a corruption card that states that a character must tap to make a roll to remove it, the character's player may apply a -3 modification to the roll in order to not tap the character at declaration. This action may be taken even if the character is already tapped, cannot be taken if an attempt to remove the same corruption card has already been made this turn, and no more attempts to remove the same corruption card as stated on that card can be made for the rest of the turn.
 * If a player is able to untap a character, they may tap the character to attempt to remove the same corruption card multiple times in a turn provided that an untapped attempt to remove that corruption card has not already been made during the turn.
 */

import { describe, expect, test, beforeEach } from 'vitest';
import {
  ALONE_AND_UNADVISED,
  ARAGORN,
  attachHazardToChar,
  buildSimpleTwoPlayerState,
  CardStatus,
  findCharInstanceId,
  grantedActionsFor,
  PLAYER_1,
  resetMint,
  setCharStatus,
} from '../../test-helpers.js';

const PLAYER_1_IDX = 0;

describe('Rule 10.08 — Removing Corruption Cards', () => {
  beforeEach(() => resetMint());

  test('tapped bearer may still attempt to remove a corruption card by taking −3 to the roll', () => {
    // Rule 10.08: "This action may be taken even if the character is already tapped."
    // The engine offers a noTap:true variant of remove-self-on-roll for any
    // corruption card, regardless of the bearer's tap state.
    let state = attachHazardToChar(buildSimpleTwoPlayerState(), PLAYER_1_IDX, ARAGORN, ALONE_AND_UNADVISED);
    state = setCharStatus(state, PLAYER_1_IDX, ARAGORN, CardStatus.Tapped);
    const aragornId = findCharInstanceId(state, PLAYER_1_IDX, ARAGORN);

    const acts = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(acts).toHaveLength(1);
    expect(acts[0].noTap).toBe(true);
  });
});
