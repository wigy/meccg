/**
 * @module rule-6.03-automatic-attacks
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.03: Step 2: Automatic-Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 2 (Automatic-Attacks) - If the site has any automatic-attacks, the first automatic-attack is initiated and resolved, followed by any additional automatic-attacks, with each proceeding immediately in the order listed on the site card. Once all automatic-attacks have been faced and regardless of whether they were defeated, the company is considered to have successfully entered the site.
 * The resource player can only take actions during a company's site phase after that company has successfully entered its site (but may still take actions during combat prior to entering the site, per the normal rules for combat).
 * Automatic-attacks must be faced when entering a site even if they were defeated during a previous turn.
 * Automatic-attacks added to a site are added to the end of the site's other automatic-attacks.
 */

import { describe, test } from 'vitest';

describe('Rule 6.03 — Step 2: Automatic-Attacks', () => {
  test.todo('Automatic-attacks resolved in order listed on site; company enters after all faced regardless of defeat');
});
