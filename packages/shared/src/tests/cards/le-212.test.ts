/**
 * @module le-212.test
 *
 * Card test: Not Slay Needlessly (le-212)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 0 — none of the card's rules are expressible via the existing
 * DSL plus engine surface today.
 *
 * Text:
 *   "Playable on an attack by Elves, Dwarves, Dúnedain, or Men. Against a
 *    covert company, the attack is canceled. Otherwise, -2 to the attack's
 *    prowess. Cannot be duplicated on a given attack."
 *
 * Engine Support:
 * | # | Rule                                                            | Status          |
 * |---|-----------------------------------------------------------------|-----------------|
 * | 1 | Playable only when the attacking creature's race is Elf,        | OK (DSL)        |
 * |   | Dwarf, Dunadan, or Man (`enemy.race` filter)                    |                 |
 * | 2 | If the defending company is COVERT → cancel the attack          | NOT IMPLEMENTED |
 * | 3 | Otherwise → -2 to the attack's prowess                          | NOT IMPLEMENTED |
 * | 4 | Cannot be duplicated on a given attack (per-attack scope)       | NOT IMPLEMENTED |
 *
 * Playable: NO — NOT CERTIFIED. Multiple engine pieces are missing:
 *
 *   - Covert/overt company state is not modeled. `detainment.ts` declares
 *     `defendingCovert?: boolean` but documents at the call site that the
 *     "Covert/overt mode is not yet implemented on companies — call sites
 *     currently pass `false`." No reducer, organization-phase action, or
 *     UI surface lets a Fallen-wizard (or Ringwraith) company toggle
 *     covert mode, and the combat condition contexts assembled by
 *     `cancelAttackActions` and `modifyAttackFromHandActions` in
 *     `packages/shared/src/engine/legal-actions/combat.ts` do not expose
 *     `defender.covert` to `when` clauses. Both branches of this card
 *     hinge on knowing whether the defender is covert, so neither mode
 *     can fire correctly today.
 *
 *   - The "otherwise" branch needs `modify-attack-from-hand` with
 *     `player: "defender"` and `prowessModifier: -2`, gated on
 *     "defender is NOT covert". The effect type and player wiring exist
 *     (used by Dragon's Desolation tw-29 with `player: "attacker"`), but
 *     without the covert context the negation has no anchor.
 *
 *   - "Cannot be duplicated on a given attack" needs a per-attack
 *     `duplication-limit` scope. Implemented scopes today are `"game"`,
 *     `"character"`, `"company"`, and `"turn"` (see usages in
 *     `legal-actions/{combat,long-event,movement-hazard,
 *     organization-events,site}.ts`). A `scope: "attack"` entry would be
 *     silently ignored, so a player could currently chain two copies
 *     against the same attack.
 *
 * Once a covert toggle exists on companies and is threaded into the
 * combat condition context as `defender.covert`, plus
 * `duplication-limit` picks up an `"attack"` scope, the card's effects
 * array would look roughly like:
 *
 *   [
 *     { "type": "cancel-attack",
 *       "when": { "$and": [
 *         { "enemy.race": { "$in": ["elf", "dwarf", "dunadan", "man"] } },
 *         { "defender.covert": true }
 *       ] } },
 *     { "type": "modify-attack-from-hand",
 *       "player": "defender",
 *       "prowessModifier": -2,
 *       "when": { "$and": [
 *         { "enemy.race": { "$in": ["elf", "dwarf", "dunadan", "man"] } },
 *         { "$not": { "defender.covert": true } }
 *       ] } },
 *     { "type": "duplication-limit", "scope": "attack", "max": 1 }
 *   ]
 *
 * At that point each `test.todo` below should be flipped into a real
 * assertion and the card re-certified.
 */

import { describe, test } from 'vitest';

describe('Not Slay Needlessly (le-212)', () => {
  test.todo('playable on an attack by an Elf creature');
  test.todo('playable on an attack by a Dwarf creature');
  test.todo('playable on an attack by a Dúnedain (dunadan) creature');
  test.todo('playable on an attack by a Man creature');
  test.todo('NOT playable on an attack by an Orc, Troll, Wolf, or other non-listed race');
  test.todo('against a covert company: the attack is canceled (no strikes assigned)');
  test.todo('against an overt (non-covert) company: the attack continues with prowess reduced by 2');
  test.todo('the -2 prowess modifier applies to every strike in the attack');
  test.todo('cannot play a second copy of Not Slay Needlessly on the same attack (per-attack duplication limit)');
  test.todo('a second copy IS playable on a later, separate attack in the same turn');
  test.todo('the card is discarded after resolving (short-event lifecycle)');
});
