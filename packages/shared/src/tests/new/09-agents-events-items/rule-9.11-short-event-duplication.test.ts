/**
 * @module rule-9.11-short-event-duplication
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.11: Short-Event Cannot Be Duplicated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Short-events that "cannot be duplicated" cannot be played if a card of the same name is currently having an effect on the entity specified by the short-event. If no entity is specified (i.e. the short-event is affecting the game generally), they cannot be played if a card of the same name is having an effect on the game.
 */

import { describe, test } from 'vitest';

describe('Rule 9.11 — Short-Event Cannot Be Duplicated', () => {
  test.todo('Short-events that cannot be duplicated cannot be played if same name already having effect on entity');
});
