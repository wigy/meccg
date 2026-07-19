/**
 * @module rule-10.27-fw-targeting-rules
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.27: Fallen-Wizard Targeting Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot target their own Orc or Troll characters with hero resources.
 * [FALLEN-WIZARD] A Fallen-wizard player may target automatic-attacks on their hero sites with minion resources, and may target automatic-attacks on their minion sites with hero resources.
 * [FALLEN-WIZARD] Restrictions on which alignments a resource can target do not apply to a Fallen-wizard player's spell and magic resources.
 */

import { describe, test } from 'vitest';

// Related to, but distinct from, the already-implemented rule 9.14 check
// (`companyHasOrcOrTroll` blocks a hero permanent-event from targeting a
// whole *company* containing an Orc/Troll). This rule is narrower: a hero
// resource specifically targeting an individual Orc/Troll *character*.
// There's no character-level race check in the generic play-target
// character-targeting code (legal-actions/organization-events.ts and
// long-event.ts), and no certified hero resource with a character-targeting
// effect has been played against an FW Orc/Troll character to prove the
// restriction is missing rather than just untested. The other two
// sub-clauses (cross-alignment automatic-attack targeting; spell/magic
// exemption) likewise have no dedicated check or exercising card.
describe('Rule 10.27 — Fallen-Wizard Targeting Rules', () => {
  test.todo('[FALLEN-WIZARD] Cannot target own Orc/Troll with hero resources; may target auto-attacks cross-alignment; spell/magic exempt from alignment restrictions');
});
