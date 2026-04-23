/**
 * @module le-136.test
 *
 * Card test: Searching Eye (le-136)
 * Type: hazard-event (short)
 * Effects: 0 — card text not expressible in the current DSL; engine lacks
 * support for cancelling a card on the chain based on the skill required to
 * play it, and for cancelling ongoing effects of already-resolved cards that
 * required a given skill.
 *
 * Text:
 *   "Cancel and discard any card requiring scout skill before it is resolved
 *    or cancel any ongoing effect of a card that required scout skill to play.
 *    If this card is played as an on-guard card, it can be revealed during the
 *    opponent's site phase to cancel and discard a card requiring scout skill
 *    before it is resolved."
 *
 * Engine Support:
 * | # | Feature                                                     | Status          |
 * |---|-------------------------------------------------------------|-----------------|
 * | 1 | Cancel a card on the chain gated by "requires scout skill"  | NOT IMPLEMENTED |
 * | 2 | Cancel ongoing effect of a permanent card that needed scout | NOT IMPLEMENTED |
 * | 3 | On-guard reveal during opponent's site phase (scout cancel) | NOT IMPLEMENTED |
 *
 * Playable: NO — NOT CERTIFIED. All three rules on the card depend on engine
 * mechanics that do not yet exist:
 *   - The chain reducer has a single cancel path (`resolveEnvironmentCancel`)
 *     which only targets cards bearing the `environment` keyword; there is
 *     no generic "cancel a chain entry whose source card required skill X to
 *     play" machinery.
 *   - The engine does not track "which skill was used to play this card", so
 *     cancelling an ongoing effect of "a card that required scout skill to
 *     play" has no anchor.
 *   - `on-guard-reveal` exists but only with the `influence-attempt` trigger
 *     (on the influence chain). A site-phase reveal that intercepts a resource
 *     play requiring scout is not wired up.
 */

import { describe, test } from 'vitest';

describe('Searching Eye (le-136)', () => {
  test.todo('cancels and discards a card requiring scout skill before it resolves');
  test.todo('cancels an ongoing effect of a permanent card that required scout skill to play');
  test.todo('when played on-guard, may be revealed during opponent site phase to cancel a scout-required card');
});
