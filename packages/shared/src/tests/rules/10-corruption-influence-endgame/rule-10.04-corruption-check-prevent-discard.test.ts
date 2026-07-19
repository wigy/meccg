/**
 * @module rule-10.04-corruption-check-prevent-discard
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.04: Prevent Discard from Corruption
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an effect prevents a character from being discarded due to a corruption check roll, the corruption check is considered successful.
 */

import { describe, test } from 'vitest';

// Corruption-check outcomes are resolved by `classifyCorruptionOutcome`
// (pending-reducers.ts) purely from the roll vs corruption points — there is
// no "prevent discard" effect hook anywhere in that path (contrast with
// body checks, which do have `protect-from-body-check`). No card in the
// current pool declares an effect that would prevent a character from being
// discarded specifically by a corruption check, so there's no reachable
// scenario to drive an implementation without inventing one.
describe('Rule 10.04 — Prevent Discard from Corruption', () => {
  test.todo('If effect prevents discard from corruption check, the check is considered successful');
});
