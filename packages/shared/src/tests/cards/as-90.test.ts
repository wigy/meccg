/**
 * @module as-90.test
 *
 * Card test: Join With That Power (as-90)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 0 — none of the card's rules are expressible via existing DSL
 * or enforced by the engine today.
 *
 * Text:
 *   "Diplomat only. One influence check or corruption check by a character
 *    in a diplomat's company receives a bonus equal to the number of
 *    characters in the company minus one. Cannot be duplicated on a given
 *    check."
 *
 * Engine Support:
 * | # | Rule                                                                    | Status          |
 * |---|-------------------------------------------------------------------------|-----------------|
 * | 1 | Playable only if the controller has a Diplomat in play                  | NOT IMPLEMENTED |
 * | 2 | Targets a character in that Diplomat's company                          | NOT IMPLEMENTED |
 * | 3 | Applies to an influence check or a corruption check (player chooses)    | NOT IMPLEMENTED |
 * | 4 | Bonus value = company.characterCount - 1                                | NOT IMPLEMENTED |
 * | 5 | Cannot be duplicated on a given check                                   | NOT IMPLEMENTED |
 *
 * Playable: NO — NOT CERTIFIED. Every clause on the card depends on engine
 * mechanics that do not yet exist:
 *
 *   - Minion short-events are not scanned for reactive corruption-check
 *     plays. `reactiveCorruptionCheckPlays` in
 *     `packages/shared/src/engine/legal-actions/pending.ts` filters the
 *     actor's hand on `def.cardType !== 'hero-resource-event'`, so a
 *     minion-resource-event declaring a `play-option` gated on
 *     `pending.corruptionCheckTargetsMe` would never be offered — even
 *     after a minion player had a pending corruption check queued.
 *
 *   - There is no reactive-play path during influence checks at all.
 *     `resolutionLegalActions` dispatches `faction-influence-roll` to a
 *     roll-only emitter that never scans the hand for short events, and
 *     `opponent-influence-defend` only emits a cancel-influence path.
 *     The card's "bonus to one influence check" clause cannot fire until
 *     this window is added symmetrically with the existing corruption
 *     reactive path.
 *
 *   - The `check-modifier` active constraint currently requires a numeric
 *     `value`. `buildPayloadConstraintKind` in
 *     `packages/shared/src/engine/reducer-organization.ts` builds the
 *     constraint payload from the `play-option` `apply` clause with a
 *     fixed number, and `corruptionCheckActions` in `pending.ts` reads
 *     `constraint.kind.value` as a plain number. A value expression like
 *     `"company.characterCount - 1"` — which is the entire point of this
 *     card — would need resolver plumbing on the constraint-creation path
 *     (and again on the constraint-read path) so the bonus can be
 *     evaluated against the bearer's company at the moment of the check.
 *
 *   - "Diplomat only" is a controller-level play requirement: the player
 *     must have at least one Diplomat in play. The DSL has no
 *     `controller.hasCharacterWithSkill` condition exposed on the hand-
 *     scan context. `buildPlayOptionContext` only builds a per-target
 *     context (`target.*`, `pending.corruptionCheckTargetsMe`,
 *     `inPlay`); nothing surfaces "the player controls a diplomat" so
 *     `play-target.filter` cannot gate on it.
 *
 *   - "A character in a diplomat's company" is a two-step target
 *     constraint: locate the company whose roster includes a diplomat,
 *     then enumerate characters in that company. `play-target` filters
 *     evaluate one candidate character in isolation — they have no way
 *     to reference sibling characters. No existing DSL condition exposes
 *     `company.characters[*].skills` or equivalent.
 *
 *   - "Cannot be duplicated on a given check" is not a board-duplication
 *     limit but a per-pending-resolution exclusion: at most one
 *     Join-With-That-Power check-modifier may attach to the same pending
 *     check. The `duplication-limit` effect scopes are "game",
 *     "character", "company", and "turn" (see
 *     `packages/shared/src/engine/legal-actions/organization-events.ts`
 *     and siblings); there is no "per-pending-resolution" scope, and
 *     the active-constraint queue does not de-duplicate by source card
 *     against the currently-resolving check.
 *
 * Once the minion reactive-corruption path accepts minion short events,
 * a reactive window opens on `faction-influence-roll` /
 * `opponent-influence-defend`, check-modifier constraints accept
 * expression-valued payloads, `controller.hasCharacterWithSkill` becomes
 * available to play-target filters, company-mate enumeration is
 * exposed, and a per-pending-resolution duplication scope is added,
 * each `test.todo` below should be flipped into a real assertion and
 * the card re-certified.
 */

import { describe, test } from 'vitest';

describe('Join With That Power (as-90)', () => {
  test.todo('playable during a pending corruption check on a character in a company that contains a Diplomat');
  test.todo('playable during a pending influence check by a character in a company that contains a Diplomat');
  test.todo('NOT playable if the controller has no Diplomat in play');
  test.todo('NOT playable when the target character is not in a company with a Diplomat');
  test.todo('bonus equals (characters in the targeted character\'s company) - 1');
  test.todo('bonus updates with company size at the moment the check resolves (not at cast time)');
  test.todo('bonus of 0 when the Diplomat is alone in the company (characterCount - 1 = 0)');
  test.todo('applies to exactly one check and is consumed when that check resolves');
  test.todo('a second copy cannot be played on a check that already has Join With That Power attached');
  test.todo('a second copy can still be played on a different pending check');
});
