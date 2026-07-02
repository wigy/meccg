/**
 * @module rule-8.03-faced-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.03: Faced an Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company or entity is considered to have "faced" an attack once the attack resolves and combat is initiated (even if the attack is then canceled; this also applies to automatic-attacks).
 */

import { describe, test } from 'vitest';

// There is no explicit "hasFaced" flag anywhere in the engine — the
// existence of `state.combat` is the only signal that an attack has been
// initiated, and there is no separate bookkeeping distinguishing "faced then
// canceled" from "never faced". The closest observable proxy is the site
// phase's `automaticAttacksResolved` counter (see rule 6.03), but no card in
// the current pool exercises "cancel this specific automatic-attack after
// combat is initiated, then confirm the site phase doesn't re-offer it" as a
// scenario distinct from the ordinary combat-finalize path already covered
// by the automatic-attack tests in section 06.
describe('Rule 8.03 — Faced an Attack', () => {
  test.todo('Company/entity has "faced" an attack once attack resolves and combat initiates, even if canceled');
});
