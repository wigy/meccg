/**
 * @module rule-3.16-fw-character-mind-limit
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.16: Fallen-Wizard Character Mind Limit
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot play a character with mind greater than five (but if they have one in play, it is not discarded).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, Phase,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, LORIEN, MORIA,
} from '../../test-helpers.js';

const ALATAR = 'wh-1' as CardDefinitionId;     // Fallen-wizard avatar (GI 17)
const ISENGARD = 'wh-56' as CardDefinitionId;  // Wizardhaven (haven)
const LOW_MIND = 'le-23' as CardDefinitionId;  // Luitprand — Man, mind 1
const HIGH_MIND = 'le-24' as CardDefinitionId; // The Mouth — Man, mind 9

describe('Rule 3.16 — Fallen-Wizard Character Mind Limit', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] cannot play a character with mind > 5; a mind ≤ 5 character is fine', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ALATAR] }],
          hand: [LOW_MIND, HIGH_MIND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const lowMindId = findHandCardId(state, RESOURCE_PLAYER, LOW_MIND);
    const highMindId = findHandCardId(state, RESOURCE_PLAYER, HIGH_MIND);

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);

    // The mind-1 character is playable; the mind-9 character is not.
    expect(viable.some(a => a.characterInstanceId === lowMindId)).toBe(true);
    expect(viable.some(a => a.characterInstanceId === highMindId)).toBe(false);
    expect(nonViable.some(a => a.characterInstanceId === highMindId)).toBe(true);
  });

  test('a Wizard player may play a character with mind > 5 (the limit is Fallen-wizard-specific)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD, characters: [ALATAR] }],
          hand: [HIGH_MIND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const highMindId = findHandCardId(state, RESOURCE_PLAYER, HIGH_MIND);
    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === highMindId)).toBe(true);
  });
});
