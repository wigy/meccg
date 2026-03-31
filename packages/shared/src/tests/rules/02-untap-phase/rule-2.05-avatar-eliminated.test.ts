/**
 * @module rule-2.05-avatar-eliminated
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.05: Avatar Eliminated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player's avatar is eliminated during the game (e.g. by failing a body check or corruption check), it is placed in its player's removed-from-play pile and provides -5 miscellaneous marshalling points to that player. A player whose avatar has been eliminated cannot reveal another avatar.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 2.05 — Avatar Eliminated', () => {
  beforeEach(() => resetMint());

  test.todo('Eliminated avatar is placed in removed-from-play pile');

  test.todo('Eliminated avatar provides -5 miscellaneous marshalling points');

  test.todo('Player whose avatar was eliminated cannot reveal another avatar');
});
