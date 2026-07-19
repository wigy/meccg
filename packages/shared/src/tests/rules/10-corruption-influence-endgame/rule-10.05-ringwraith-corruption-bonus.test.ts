/**
 * @module rule-10.05-ringwraith-corruption-bonus
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.05: Ringwraith/Balrog Corruption Bonus
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A character in the same company as a Ringwraith receives an additional +2 modifier to corruption checks.
 * [BALROG] A character in the same company as the Balrog receives an additional +2 modifier to corruption checks.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase } from '../../../index.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../../index.js';
import {
  buildTestState, resetMint, viableActions,
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN,
  findCharInstanceId,
} from '../../test-helpers.js';
import { enqueueCorruptionCheck } from '../../../engine/pending.js';

// Minion character sharing a company with the avatar (not itself a
// Ringwraith/Balrog, to isolate the companion bonus).
const GORBAG = 'le-11' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId; // Ringwraith avatar (race: ringwraith)
const THE_BALROG = 'ba-3' as CardDefinitionId; // Balrog avatar (race: balrog, mind: null)
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

function checkModifierFor(alignment: Alignment, avatarDefId: CardDefinitionId) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment, companies: [{ site: CARN_DUM, characters: [GORBAG, avatarDefId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_MINION] },
    ],
  });
  const gorbagId = findCharInstanceId(base, 0, GORBAG);
  const state = enqueueCorruptionCheck(base, {
    source: null,
    actor: PLAYER_1,
    scope: { kind: 'phase', phase: Phase.Organization },
    characterId: gorbagId,
    reason: 'test',
  });
  const [action] = viableActions(state, PLAYER_1, 'corruption-check');
  return (action.action as CorruptionCheckAction).corruptionModifier;
}

describe('Rule 10.05 — Ringwraith/Balrog Corruption Bonus', () => {
  beforeEach(() => resetMint());

  test('[MINION] a character in the same company as a Ringwraith gets +2', () => {
    expect(checkModifierFor(Alignment.Ringwraith, ADUNAPHEL)).toBe(2);
  });

  test('[BALROG] a character in the same company as the Balrog gets +2', () => {
    expect(checkModifierFor(Alignment.Balrog, THE_BALROG)).toBe(2);
  });

  test('control: no bonus without a Ringwraith/Balrog avatar in the company', () => {
    // Shagrat is a plain minion character, not an avatar.
    const SHAGRAT = 'le-39' as CardDefinitionId;
    expect(checkModifierFor(Alignment.Ringwraith, SHAGRAT)).toBe(0);
  });
});
