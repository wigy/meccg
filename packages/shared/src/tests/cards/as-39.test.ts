/**
 * @module as-39.test
 *
 * Card test: Summons from Long Sleep (as-39)
 * Type: hazard-event (permanent)
 * Effects: 0 (engine does not yet support the reservation mechanic)
 *
 * Card text:
 *   "This card reserves up to one Dragon or Drake hazard creature at a
 *    time. To reserve a Dragon or Drake creature, place it face up 'off
 *    to the side' with this card (not counting against the hazard
 *    limit). You may play a reserved creature as though it were in your
 *    hand. Discard this card after the reserved creature attacks. A
 *    reserved Dragon or Drake receives +2 prowess when attacking."
 *
 * NOT CERTIFIED. The card introduces a per-permanent-event reservation
 * slot that has no analogue in the current engine. Every rule on the
 * card depends on engine support that does not exist yet:
 *
 *   1. A "reserved" sub-zone attached to this permanent-event
 *      (currently no state holds creatures off-to-the-side with a
 *      specific card; `setAside` is setup-only and not keyed to a
 *      permanent-event instance).
 *   2. A `reserve-creature` player action moving a Dragon/Drake hazard
 *      creature out of hand into that slot.
 *   3. Hazard-limit exemption while the creature is reserved (and then
 *      the creature counts normally once played out of the slot).
 *   4. Treating reserved creatures as playable as-if-in-hand during
 *      the opponent's movement/hazard phase (extending the `play-hazard`
 *      legal-action computer to scan the reservation slot in addition
 *      to `player.hand`).
 *   5. Discarding the permanent-event when the reserved creature
 *      attacks (requires working `on-event` triggers — currently
 *      `matchesTrigger()` in chain-reducer.ts always returns false).
 *   6. A +2 prowess modifier conditional on the attacking creature
 *      being the one reserved by this card (requires exposing
 *      `attacker.isReserved` or similar in the stat-modifier context).
 *
 * Until these six pieces land, the card's data `effects` array is
 * intentionally empty — partial DSL effects would be worse than none
 * because they would silently grant the prowess bonus without gating
 * on reservation. The tests below are `test.todo()` placeholders for
 * the eventual implementation.
 */

import { describe, test } from 'vitest';

describe('Summons from Long Sleep (as-39)', () => {
  test.todo('reserves a Dragon or Drake hazard creature into an off-to-the-side slot');
  test.todo('refuses to reserve a non-Dragon / non-Drake hazard creature');
  test.todo('reservation does not count against the hazard limit');
  test.todo('a reserved creature is offered as a play-hazard action as if from hand');
  test.todo('a reserved Dragon or Drake attacks with +2 prowess');
  test.todo('the permanent-event is discarded after the reserved creature attacks');
  test.todo('only one creature can be reserved at a time');
});
