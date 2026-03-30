/**
 * @module rule-9.23-gold-ring-ringwraith-test
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.23: Gold Ring Auto-Test in Ringwraith/Balrog Company
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] Any gold ring item being borne by a character in a Ringwraith's company is automatically tested at the beginning of the end-of-turn phase, and gold ring items tested in a Ringwraith's company have a -2 modification to the ring test roll.
 * [MINION] A Ringwraith player's gold ring items at Barad-Dûr are automatically tested at the beginning of the end-of-turn phase, and a Ringwraith player's gold ring items tested at Barad-Dûr have a -3 modification to the ring test roll.
 * [FALLEN-WIZARD] A hero gold ring item tested by a Fallen-wizard player has an additional -1 modification to the ring test roll.
 * [FALLEN-WIZARD] A Fallen-wizard player may play special ring items of any alignment and regardless of the alignment of the gold ring item tested.
 * [BALROG] Any gold ring item being borne by a character in a Balrog's company is automatically tested at the beginning of the end-of-turn phase, and gold ring items tested in a Balrog's company have a -2 modification to the ring test roll.
 */

import { describe, test } from 'vitest';

describe('Rule 9.23 — Gold Ring Auto-Test in Ringwraith/Balrog Company', () => {
  test.todo('[MINION] Gold ring in Ringwraith company auto-tested at end of turn with -2; [MINION] at Barad-Dûr with -3; [BALROG] in Balrog company with -2');
});
