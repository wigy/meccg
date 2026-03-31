/**
 * @module rule-8.28-body-check
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.28: Body Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The declaration of a body check initiates a chain of effects during which actions can only be declared if they would directly affect the body check (i.e. either affecting the roll or the body of the entity making the body check). To resolve a body check, the player who doesn't control the entity makes a roll and applies any modifications, including a +1 modification to the roll if the entity was already wounded before failing a strike that led to the body check. If the modified roll is higher than the entity's body, the entity fails the body check.
 */

import { describe, test } from 'vitest';

describe('Rule 8.28 — Body Check', () => {
  test.todo('Non-controlling player rolls 2D6; +1 if already wounded; if > body, entity is eliminated');
});
