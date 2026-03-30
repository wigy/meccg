/**
 * @module rule-10.28-effects-definition
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.28: Effects Definition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An effect is what is implemented by a played card or other declared action immediately upon resolution.
 * Effects of a card in play last until the card leaves play or its effects become invalid, at which point those effects end immediately. As an exception, if a card is discarded as an active condition for one of its effects, the resolved effect lasts for as long as specified on the card but no longer than the end of the turn if no duration is specified.
 * If a card or all of its effects are canceled, the card is immediately discarded.
 * If a card effect directly conflicts with a rule or another card effect without clarifying how to resolve the conflict, the most recently implemented effect takes precedence (but specifically in the context of the conflict, i.e. if a card's effect overrides part of a rule, the rest of that rule is still in effect).
 * If an effect is templated such that a character or some other card "may" take an action, the card's player may use the card to take the action.
 */

import { describe, test } from 'vitest';

describe('Rule 10.28 — Effects Definition', () => {
  test.todo('Effects implemented upon resolution; last until card leaves play; most recently implemented effect wins conflicts');
});
