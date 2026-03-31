/**
 * @module rule-9.20-alignment-item-usage
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.20: Alignment Item Usage Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A minion item borne by a Wizard player's character cannot be used.
 * [MINION] A hero item borne by a Ringwraith player's character cannot be used.
 * [MINION] Ringwraiths may bear items but those items cannot be used.
 * [FALLEN-WIZARD] A Fallen-wizard player's non-Orc, non-Troll characters may bear and use both hero and minion items. A Fallen-wizard player's Orc and Troll characters may bear both hero and minion items, but those characters can only use minion items.
 * [BALROG] A hero item borne by a Balrog player's character cannot be used.
 * [BALROG] Balrogs may bear items but those items cannot be used.
 */

import { describe, test } from 'vitest';

describe('Rule 9.20 — Alignment Item Usage Restrictions', () => {
  test.todo('Hero cannot use minion items; Minion cannot use hero items; Ringwraiths/Balrogs bear but cannot use; FW specific rules');
});
