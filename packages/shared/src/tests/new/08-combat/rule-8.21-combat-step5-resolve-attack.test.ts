/**
 * @module rule-8.21-combat-step5-resolve-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.21: Step 5: Resolve the Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 5 (Resolve the Attack) - When the final strike and all associated body checks and/or effects have been resolved, the attack concludes as follows:
 * • Creature Attacks - If at least one strike was assigned and all assigned strikes were defeated, the creature is defeated and placed in the marshalling point pile of the defending player (unless detainment or taken as a trophy). If any of the strikes were not defeated or if no strikes were assigned, the creature is immediately discarded. The same applies to hazard events that create an attack and have a marshalling point value designated as kill points.
 * • Automatic-Attacks and Rescue-attacks - If at least one strike was assigned and all assigned strikes were defeated, the attack is defeated. Creature cards played as automatic-attacks are immediately discarded.
 * • Agent Hazard Attacks - Each time one of its strikes fails, the agent hazard is wounded and must make a body check. If all strikes are defeated and all body checks fail, a defending hero or Fallen-Wizard player may place the agent in their own marshalling point pile to be counted as kill MPs; otherwise the agent is removed from play.
 * • Company vs. Company Combat - Each character defeated by a strike is wounded and must make a body check. If the character is eliminated, it counts as kill MPs for the opposing player.
 */

import { describe, test } from 'vitest';

describe('Rule 8.21 — Step 5: Resolve the Attack', () => {
  test.todo('When final strike resolved: creature defeated if all assigned strikes defeated; auto-attacks have own rules; agent attacks have own rules');
});
