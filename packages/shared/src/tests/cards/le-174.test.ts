/**
 * @module le-174.test
 *
 * Card test: By the Ringwraith's Word (le-174)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 * Effects: 0 — none of the card's rules are expressible via existing DSL
 * or enforced by the engine today.
 *
 * Text:
 *   "Playable during the organization phase on one of your other characters
 *    at the same Darkhaven [{DH}] as your Ringwraith. The character: becomes
 *    a leader (if not already), receives +4 direct influence against
 *    characters in his company, and cannot be discarded by a body check.
 *    Discard at any time if there is a character in his company with a
 *    higher mind. Cannot be duplicated by a given player. Cannot be included
 *    in a Balrog's deck."
 *
 * Engine Support:
 * | # | Rule                                                           | Status          |
 * |---|----------------------------------------------------------------|-----------------|
 * | 1 | Playable during organization phase on non-Ringwraith character | NOT IMPLEMENTED |
 * | 2 | Playability gated on bearer being at the same Darkhaven as     | NOT IMPLEMENTED |
 * |   | the controlling player's Ringwraith                            |                 |
 * | 3 | Target character becomes a leader (if not already)             | NOT IMPLEMENTED |
 * | 4 | +4 direct influence for the bearer against characters in his  | NOT IMPLEMENTED |
 * |   | own company                                                    |                 |
 * | 5 | Bearer cannot be discarded by a body check                     | NOT IMPLEMENTED |
 * | 6 | Auto-discard while a character in bearer's company has a       | NOT IMPLEMENTED |
 * |   | higher mind than the bearer                                    |                 |
 * | 7 | Cannot be duplicated by a given player (per-player copy limit) | NOT IMPLEMENTED |
 * | 8 | Cannot be included in a Balrog's deck (deck construction)      | NOT IMPLEMENTED |
 *
 * Playable: NO — NOT CERTIFIED. Every clause on the card depends on engine
 * mechanics that do not yet exist:
 *
 *   - The organization-phase permanent-event emitter
 *     (`playPermanentEventActions` in
 *     `packages/shared/src/engine/legal-actions/organization-events.ts`)
 *     only iterates `hero-resource-event` definitions; minion permanent
 *     events are never offered as legal `play-permanent-event` actions
 *     unless they carry the `playable-as-hazard` flag. No code path
 *     currently lets a minion player bring a permanent minion resource
 *     event into play from hand, which means this card cannot be played
 *     at all.
 *
 *   - There is no "leader" concept in the engine. Rule 3.26 ("A company
 *     can only contain one leader unless at a haven") is still a
 *     `test.todo` in
 *     `rules/03-organization-phase/rule-3.26-leader-restriction.test.ts`
 *     and no `CharacterInPlay` field, stat-modifier target, or DSL effect
 *     type exists to express "character becomes a leader."
 *
 *   - Direct-influence stat-modifiers resolve against a `reason:
 *     "influence-check"` context carrying `bearer` and `target` (name +
 *     race). The context has no "target is in bearer's own company" flag,
 *     so "+4 DI against characters in his company" is not expressible
 *     today — the engine cannot distinguish DI applied to a target in
 *     the bearer's own company from DI applied to anyone else.
 *
 *   - Body-check failure in `handleBodyCheckRoll`
 *     (`packages/shared/src/engine/reducer-combat.ts`) unconditionally
 *     moves the character to the out-of-play pile when
 *     `effectiveRoll > body`. There is no per-character
 *     "cannot-be-discarded-by-body-check" constraint or DSL effect
 *     consulted at that site.
 *
 *   - There is no passive state-check sweeper that re-evaluates
 *     "is there a character in this company with a higher mind than
 *     my bearer?" whenever a company's roster or card mind values
 *     change. The closest existing piece is `sweepAutoDiscardHazards`
 *     in `reducer-utils.ts`, which only handles
 *     `on-event: company-composition-changed` for bearer-side hazards.
 *     Extending it for a minion-resource-event that lives on the
 *     resource side and must compare mind values across siblings is
 *     new work.
 *
 *   - `duplication-limit` is enforced only for scopes `"game"`,
 *     `"character"`, `"company"`, and `"turn"`
 *     (`packages/shared/src/engine/legal-actions/organization-events.ts`,
 *     `long-event.ts`, `movement-hazard.ts`, `site.ts`, `combat.ts`).
 *     A `scope: "player"` entry would be ignored — each player
 *     independently limited to one copy in play needs a new branch in
 *     the permanent-event emitter.
 *
 *   - Deckbuilding constraints ("Cannot be included in a Balrog's
 *     deck") are outside the game engine entirely; they belong in the
 *     deckbuilder / deck-legality layer, which is not represented in
 *     the rules test suite.
 *
 * Once the minion permanent-event play path exists, a leader concept
 * lands, DI context exposes target-in-bearer-company, body-check
 * protection + passive auto-discard sweepers are added, and
 * `duplication-limit` picks up a `"player"` scope, each `test.todo`
 * below should be flipped into a real assertion and the card
 * re-certified.
 */

import { describe, test } from 'vitest';

describe('By the Ringwraith\'s Word (le-174)', () => {
  test.todo('playable during organization phase on a non-Ringwraith character at the same Darkhaven as the controller\'s Ringwraith');
  test.todo('NOT playable if the target character is not at a Darkhaven');
  test.todo('NOT playable if the controller\'s Ringwraith is not at the same Darkhaven as the target');
  test.todo('NOT playable on the Ringwraith itself ("one of your OTHER characters")');
  test.todo('while attached, the bearer counts as a leader even if the base character has no leader skill');
  test.todo('while attached, the bearer gets +4 direct influence against characters in his own company');
  test.todo('+4 DI does not apply when the bearer targets a character outside his own company');
  test.todo('while attached, a failed body check on the bearer does NOT eliminate him');
  test.todo('the bearer card is auto-discarded when a company-mate has a higher mind than the bearer');
  test.todo('the bearer card stays in play while no company-mate has a higher mind than the bearer');
  test.todo('a player cannot play a second copy of this card while one is already in play under their control');
  test.todo('the opposing Ringwraith player may still play their own copy while one is in play under the other player');
});
