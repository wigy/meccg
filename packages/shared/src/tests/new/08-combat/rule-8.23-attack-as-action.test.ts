/**
 * @module rule-8.23-attack-as-action
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.23: Attack as Action
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An attack involves dice-rolling and many other actions when it resolves into combat, so initiating an attack is considered its own action and the declaration of an attack due to a passive condition will thus initiate a new chain of effects.
 * An action that would potentially initiate combat during its resolution must initiate a chain of effects, meaning that it cannot be taken in response (except for on-guard cards). Such an action also cannot be taken during combat.
 * Once an attack resolves into combat in a chain of effects, it can no longer be canceled by the card that created the attack leaving play.
 */

import { describe, test } from 'vitest';

describe('Rule 8.23 — Attack as Action', () => {
  test.todo('Initiating attack is its own action; must initiate chain of effects; cannot be taken during combat or in response');
});
