/**
 * @module rule-10.10-influence-attempt-declaration
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.10: Declaring an Influence Attempt
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Declaring an Influence Attempt - A resource player may declare during their site phase that one of their characters is making an influence attempt against an opponent's card by tapping the character (as an active condition) if all of the following conditions are true:
 * • It is not the resource player's first turn;
 * • The company of the character making the influence attempt has entered its site this turn;
 * • The resource player has not made an influence attempt against any of the hazard player's cards this turn nor attacked any of the hazard player's companies this turn;
 * • The influence attempt is not against an avatar nor a card controlled by an avatar; and
 * • If an avatar is being tapped to make the influence attempt, the avatar cannot have been played this turn.
 */

import { describe, test } from 'vitest';

describe('Rule 10.10 — Declaring an Influence Attempt', () => {
  test.todo('Tap character at site to influence opponent card; not first turn; must have entered site; no prior influence/attack this turn');
});
