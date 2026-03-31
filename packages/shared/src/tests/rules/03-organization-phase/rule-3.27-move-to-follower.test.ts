/**
 * @module rule-3.27-move-to-follower
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.27: Move Character to Follower
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may move a non-avatar character without followers to the control of a non-follower character in the same company while organizing during the organization phase. This action can only be taken if the controlled character's mind is less than or equal to the controlling character's available direct influence, before any modifications are applied to the controlled character's mind as a result of being a follower.
 */

import { describe, test } from 'vitest';

describe('Rule 3.27 — Move Character to Follower', () => {
  test.todo('May move non-avatar non-follower character to control of non-follower character in same company if mind <= available DI');
});
