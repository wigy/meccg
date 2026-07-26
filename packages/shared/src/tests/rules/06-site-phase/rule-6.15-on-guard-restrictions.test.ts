/**
 * @module rule-6.15-on-guard-restrictions
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.15: On-Guard Reveal Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A hazard cannot be revealed in this way if it meets any of the following criteria:
 * a) Returns the company to its site of origin
 * b) Taps the company's site
 * c) Potentially removes a character from the company, unless via combat or corruption checks (but a card that potentially removes an ally may be revealed)
 * d) Forces the company to do nothing during its site phase
 * e) Directly taps a character in the company.
 */

import { describe, test } from 'vitest';

// None of these five restrictions is computed dynamically by the engine —
// `revealOnGuardAttacksActions` (site.ts) and `onGuardWindowActions`
// (pending.ts) only gate reveal eligibility on the card's own declared
// `on-guard-reveal` trigger (creature keying / hazard-event-affects-auto-attack
// / resource-play / influence-attempt), never on what the card's *other*
// effects would do to the company. The restriction is instead enforced by
// data curation: only the cards carrying `on-guard-reveal` in the current
// pool (Foolish Words td-25/le-112, Searching Eye le-136/td-67, Heedless
// Revelry le-114, Lure of Expedience tw-57/le-122) were authored to comply,
// and none has an effect that would return the company to its site of
// origin, tap the site, remove a character (or discard an ally — the one
// case the rule explicitly still permits), force the company to do nothing,
// or directly tap a character. Lure of Expedience can eventually remove its
// bearer, but only through a corruption check, which clause (c) explicitly
// permits; the tap it grants is an optional organization-phase action taken
// by the bearer's own controller, not a direct tap. There is no reachable
// scenario to prove any of the five checks fires without first authoring a
// non-compliant card, which would test invented data rather than the
// engine.
describe('Rule 6.15 — On-Guard Reveal Restrictions', () => {
  test.todo('On-guard cannot: return to origin, tap site, remove character (except via combat/CC), force do-nothing, or directly tap character');
});
