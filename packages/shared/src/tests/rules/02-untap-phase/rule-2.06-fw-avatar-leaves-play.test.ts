/**
 * @module rule-2.06-fw-avatar-leaves-play
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.06: Fallen-Wizard Avatar Leaves Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] If a Fallen-wizard player's avatar leaves play, that player must immediately discard all of their Stage resource permanent-events in play that are specific to the avatar.
 * [FALLEN-WIZARD] If a Fallen-wizard player's avatar has been eliminated, that player cannot play Stage resource cards that are specific to the avatar, and the player no longer counts "as" that Fallen-wizard for the purpose of non-specific Stage resource cards.
 */

import { describe, test } from 'vitest';

describe('Rule 2.06 — Fallen-Wizard Avatar Leaves Play', () => {
  // Fallen-wizard alignment is not yet implemented — these remain as todo specs.

  test.todo('[FALLEN-WIZARD] FW avatar leaves play: discard all avatar-specific Stage resource permanent-events');

  test.todo('[FALLEN-WIZARD] FW avatar eliminated: cannot play avatar-specific Stage resource cards');

  test.todo('[FALLEN-WIZARD] FW avatar eliminated: player no longer counts as that FW for non-specific Stage resources');
});
