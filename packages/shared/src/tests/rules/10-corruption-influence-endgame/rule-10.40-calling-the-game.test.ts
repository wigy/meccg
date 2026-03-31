/**
 * @module rule-10.40-calling-the-game
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.40: Calling the Game
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Calling the Game - The conditions that allow the normal end of the game to be initiated depend on the predetermined length of the game.
 * Starter ("1-deck") Game - If a player currently has at least 20 marshalling points not including cards at Under-deeps sites OR has exhausted their own play deck at least once, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least once, the game ends after the current turn.
 * Short ("2-deck") Game - If a player currently has at least 25 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least once OR has exhausted their own play deck at least twice, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least twice, the game ends after the current turn.
 * Long ("3-deck") Game - If a player currently has at least 30 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least twice OR has exhausted their own play deck at least three times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least three times, the game ends after the current turn.
 * Campaign ("4-deck") Game - If a player currently has at least 40 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least three times OR has exhausted their own play deck at least four times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least four times, the game ends after the current turn.
 */

import { describe, test } from 'vitest';

describe('Rule 10.40 — Calling the Game', () => {
  test.todo('Game end conditions depend on game length: Starter (20 MP or 1 exhaust), Short (25 MP + 1 exhaust or 2), Long (30 MP + 2 or 3), Campaign (40 MP + 3 or 4)');
});
