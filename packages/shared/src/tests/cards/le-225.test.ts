/**
 * @module le-225.test
 *
 * Card test: Ruse (le-225)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 0 — neither of the card's two modes is expressible via existing
 * DSL or enforced by the engine today.
 *
 * Text:
 *   "Diplomat only. Scout only. Playable on a untapped diplomat in a covert
 *    company facing an attack. Tap the diplomat. The attack is canceled.
 *    Alternatively, playable on a scout facing an attack. No strikes of the
 *    attack may be assigned to the scout."
 *
 * Modes:
 *   Mode A (Diplomat): the player taps an untapped diplomat in the defending
 *     (covert) company to cancel the attack outright.
 *   Mode B (Scout): the player plays the event during an attack; no strikes
 *     in the attack may be assigned to the scout.
 *
 * Engine Support:
 * | # | Rule                                                                 | Status          |
 * |---|----------------------------------------------------------------------|-----------------|
 * | 1 | Mode A: playable on an untapped diplomat facing an attack            | PARTIAL         |
 * | 2 | Mode A: diplomat must be in a COVERT company                         | NOT IMPLEMENTED |
 * | 3 | Mode A: taps the diplomat and cancels the attack                     | PARTIAL         |
 * | 4 | Mode B: playable on a scout facing an attack (no tap cost)           | NOT IMPLEMENTED |
 * | 5 | Mode B: no strikes of the attack may be assigned to the scout        | NOT IMPLEMENTED |
 * | 6 | Two alternative modes on one short event (skill-A OR skill-B)        | NOT IMPLEMENTED |
 *
 * Playable: NO — NOT CERTIFIED. Every clause on the card depends on engine
 * mechanics that do not yet exist:
 *
 *   - Company covert/overt status is not represented in game state.
 *     `Company` in `packages/shared/src/types/state-cards.ts` has no covert
 *     field, the organization phase has no action to toggle it, and
 *     `detainment.ts` explicitly comments that "Covert/overt mode is not
 *     yet implemented on companies — call sites currently pass `false`."
 *     Rule 8.26 ("company composition and overt/covert status is checked
 *     at the beginning of each attack") is still `test.todo` in
 *     `rules/08-combat/rule-8.26-company-check-at-attack.test.ts`. Mode A's
 *     "in a covert company" precondition therefore has no hook in the
 *     combat legal-action path. The `whenContext` built in
 *     `cancelAttackActions` (`legal-actions/combat.ts`) exposes
 *     `enemy.race`, `attack.source`, `attack.keying`, `bearer.companySize`,
 *     and `bearer.atHaven`; it does not expose any `company.covert` or
 *     equivalent, so even adding a `when` clause to the card's DSL cannot
 *     gate on covert status today.
 *
 *   - No strike-immunity-per-character mechanic exists. Strike assignment
 *     in `reducer-combat.ts` / `chain-reducer.ts` enumerates the defending
 *     company's characters and lets the defender pick any of them; there
 *     is no per-character "cannot be assigned strikes from this attack"
 *     constraint, and the DSL has no effect type that creates one. Mode B
 *     ("no strikes of the attack may be assigned to the scout") therefore
 *     has nothing in the engine to hook into — it cannot be represented
 *     as `cancel-attack`, `halve-strikes`, `dodge-strike`, or any existing
 *     strike-window effect.
 *
 *   - The existing `cancel-attack` DSL supports a single `requiredSkill`
 *     on a card. Ruse's two modes (diplomat-cancels-attack and
 *     scout-excludes-from-strikes) have different costs (tap vs no cost)
 *     AND different effects (cancel-entire-attack vs exclude-character).
 *     There is no card-level construct for "pick one of these two modes
 *     when playing the event", so even after the two individual pieces
 *     are implemented the card would need a new multi-mode short-event
 *     representation. Today, if one mode were encoded as a `cancel-attack`
 *     effect the engine would treat it as the only mode — the other
 *     would be silently dropped.
 *
 *   - The Fallen-wizard covert/overt-hazards rule (5.25) is still
 *     `test.todo`; the downstream of "which companies may become covert,
 *     and how" is undecided in the rules test suite, so even if a covert
 *     field were added to `Company`, there is no code path that would
 *     ever set it to true in a game exercising Ruse. (Rule 8.41 restricts
 *     the covert concept to Fallen-wizard companies in canonical play,
 *     but this card's own flavour implies Ringwraith companies can also
 *     be covert — a rules interaction that has not been resolved in the
 *     engine.)
 *
 * Once company covert/overt state lands on `Company`, a strike-exclusion
 * effect type exists in the DSL + combat reducer, and short events gain a
 * multi-mode representation, each `test.todo` below should be flipped into
 * a real assertion and the card re-certified.
 */

import { describe, test } from 'vitest';

describe('Ruse (le-225)', () => {
  // Mode A — diplomat cancels the attack
  test.todo('Mode A: playable by the defending minion player during assign-strikes when the defending company has an untapped diplomat AND is covert');
  test.todo('Mode A: NOT playable when the defending company has no diplomat');
  test.todo('Mode A: NOT playable when the only diplomat in the company is tapped');
  test.todo('Mode A: NOT playable when the defending company is overt (not covert)');
  test.todo('Mode A: executing the action taps the chosen diplomat and discards Ruse from hand');
  test.todo('Mode A: executing the action cancels the attack (combat resolves with creature discarded, no strikes assigned)');
  test.todo('Mode A: NOT available to the attacking player');

  // Mode B — scout is excluded from strike assignment
  test.todo('Mode B: playable by the defending minion player during assign-strikes when the defending company has a scout');
  test.todo('Mode B: NOT playable when the defending company has no scout');
  test.todo('Mode B: playing Ruse on a scout discards Ruse but does NOT tap the scout (no cost beyond discarding the event)');
  test.todo('Mode B: after Ruse is played, strike assignment rejects any assignment targeting the named scout');
  test.todo('Mode B: after Ruse is played, strikes may still be assigned to OTHER characters in the company');
  test.todo('Mode B: the exclusion applies only to THIS attack — subsequent attacks against the same company may assign strikes to the scout again');

  // Mode selection
  test.todo('a single copy in hand presents both modes when the company has an untapped diplomat AND a scout in a covert company');
  test.todo('playing Ruse requires selecting a mode; the two modes cannot both resolve from one copy');
});
