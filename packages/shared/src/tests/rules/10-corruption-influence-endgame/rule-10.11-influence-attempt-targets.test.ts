/**
 * @module rule-10.11-influence-attempt-targets
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.11: Influence Attempt Target Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Additionally, the following conditions must also be true depending on the type of card being influenced:
 * • Ally - The resource player's character is at the same site as the ally being influenced.
 * • Character - The resource player's character is at the same site as the character being influenced.
 * • Faction - The resource player's character is at a site where the faction is playable.
 * • Item - The resource player's character is at the same site as the item being influenced, the item being influenced does not have a permanent-event played on it, AND the resource player must reveal an identical item card in their hand (of any alignment).
 * When declaring an influence attempt against an ally, character, or faction, the resource player may reveal an identical resource card in their hand (of any alignment), even if that player wouldn't be able to play the card following the influence attempt.
 */

import { describe, test } from 'vitest';

describe('Rule 10.11 — Influence Attempt Target Conditions', () => {
  test.todo('Ally/character: same site; faction: playable site; item: same site + no permanent-event + reveal identical item');
});
