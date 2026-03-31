/**
 * @module rule-8.04-attack-modification-rules
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.04: Attack Modification Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Attacks can only be modified by effects that specifically refer to attacks.
 * A resource/character action that would cancel or otherwise directly affect an attack can only be taken if the resource or character with the effect is in the company facing the attack or is a resource event not associated with any company. This does not apply to resource/character actions that would affect the region or site type to which a creature attack has been keyed.
 * Attacks or strikes keyed by name to a region or site cannot be canceled by effects that only refer to the type of the region or site.
 */

import { describe, test } from 'vitest';

describe('Rule 8.04 — Attack Modification Rules', () => {
  test.todo('Attacks can only be modified by effects that specifically refer to attacks; cancel only from company or non-associated resource event');
});
