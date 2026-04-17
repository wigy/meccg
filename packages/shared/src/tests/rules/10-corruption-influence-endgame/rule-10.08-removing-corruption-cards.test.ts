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

import { describe, test } from 'vitest';

describe('Rule 10.08 — Removing Corruption Cards', () => {
  // Coverage lives in rule-metd-corruption-no-tap.test.ts (METD §7
  // generalized this from a single METW Insert clause into a per-card
  // lockable variant). That test exercises both removal pathways and
  // the per-character per-card per-turn lock.
  test.todo('Tap character to roll to remove corruption card; may apply -3 to skip tapping; once per turn per card');
});
