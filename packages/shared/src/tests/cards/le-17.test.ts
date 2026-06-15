/**
 * @module le-17.test
 *
 * Card test: Jerrek (le-17)
 * Type: minion-character (man, ringwraith, unique, prowess 5 / body 8 / mind 4,
 *       base direct influence 0, homesite Southron Oasis)
 *
 * "Unique. +1 direct influence against any faction playable at Southron Oasis."
 *
 * Effect tested:
 * 1. stat-modifier: +1 direct-influence during a faction-influence-check when
 *    the faction's `playableAt` list contains "Southron Oasis". Modelled the
 *    same way as Perchen (as-4), whose +3 bonus is gated on Dunnish Clan-hold.
 *
 * Fixture alignment: minion-character (ringwraith), so the company is built
 * with `buildMinionSitePhaseState`. The factions playable at Southron Oasis are
 * the ringwraith factions Haradrim (as-63, influence # 10) and Southrons
 * (le-287, influence # 9). Goblins of Goblin-gate (le-265, playable at
 * Goblin-gate) is the control: Jerrek's bonus must NOT apply there.
 *
 * Note: this branch also corrects the data of Haradrim (as-63) and Southrons
 * (le-287), whose `playableAt` was empty and `influenceNumber` was 0 — they are
 * now playable at Southron Oasis per their printed text. Those factions are NOT
 * certified here (their Standard Modifications are not yet modelled).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint,
  PLAYER_1, RESOURCE_PLAYER,
  findCharInstanceId, getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const JERREK = 'le-17' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId; // control: man, DI 0, no effects

const HARADRIM = 'as-63' as CardDefinitionId;   // playable at Southron Oasis, influence # 10
const SOUTHRONS = 'le-287' as CardDefinitionId; // playable at Southron Oasis, influence # 9
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // playable at Goblin-gate, influence # 9

const SOUTHRON_OASIS = 'le-404' as CardDefinitionId; // minion border-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // minion shadow-hold

/** Find the influence-attempt action made by a specific character against a faction. */
function attemptBy(
  state: ReturnType<typeof buildMinionSitePhaseState>,
  characterDefId: CardDefinitionId,
  factionInstanceId: string,
): InfluenceAttemptAction | undefined {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, characterDefId);
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === charId && a.factionInstanceId === factionInstanceId);
}

describe('Jerrek (le-17)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: the conditional bonus does not inflate base DI ──────────────

  test('base effective DI is 0 (conditional faction bonus does not inflate base stats)', () => {
    const state = buildMinionSitePhaseState({ characters: [JERREK], site: SOUTHRON_OASIS });
    expect(getCharacter(state, RESOURCE_PLAYER, JERREK).effectiveStats.directInfluence).toBe(0);
  });

  // ─── Effect 1: +1 DI vs a faction playable at Southron Oasis ─────────────────

  test('+1 DI bonus applies vs Haradrim at Southron Oasis (isolated against a control character)', () => {
    // Jerrek (DI 0) and Luitprand (DI 0, no effects) share a company at Southron
    // Oasis. Haradrim (influence # 10) is playable there. Jerrek's attempt gets
    // the +1; Luitprand's does not — the only difference between the two attempts
    // proves the bonus is the effect and not something structural.
    const state = buildMinionSitePhaseState({
      characters: [JERREK, LUITPRAND],
      site: SOUTHRON_OASIS,
      hand: [HARADRIM],
    });
    const factionId = state.players[0].hand[0].instanceId as string;

    const jerrek = attemptBy(state, JERREK, factionId);
    const luitprand = attemptBy(state, LUITPRAND, factionId);

    expect(jerrek).toBeDefined();
    expect(luitprand).toBeDefined();
    // influence # 10 - (DI 0 + bonus 1) = 9
    expect(jerrek!.need).toBe(9);
    expect(jerrek!.explanation).toContain('DI bonus +1');
    // influence # 10 - DI 0 = 10, no bonus for the control character
    expect(luitprand!.need).toBe(10);
    expect(luitprand!.explanation).not.toContain('DI bonus');
  });

  test('+1 DI bonus also applies vs Southrons at Southron Oasis', () => {
    const state = buildMinionSitePhaseState({
      characters: [JERREK],
      site: SOUTHRON_OASIS,
      hand: [SOUTHRONS],
    });
    const factionId = state.players[0].hand[0].instanceId as string;

    const jerrek = attemptBy(state, JERREK, factionId);
    expect(jerrek).toBeDefined();
    // influence # 9 - (DI 0 + bonus 1) = 8
    expect(jerrek!.need).toBe(8);
    expect(jerrek!.explanation).toContain('DI bonus +1');
  });

  test('+1 DI bonus does NOT apply to a faction not playable at Southron Oasis', () => {
    // Goblins of Goblin-gate (influence # 9) is playable at Goblin-gate, not
    // Southron Oasis, so Jerrek's bonus must not fire there.
    const state = buildMinionSitePhaseState({
      characters: [JERREK],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });
    const factionId = state.players[0].hand[0].instanceId as string;

    const jerrek = attemptBy(state, JERREK, factionId);
    expect(jerrek).toBeDefined();
    // influence # 9 - DI 0 = 9 (no playable-at match → no bonus)
    expect(jerrek!.need).toBe(9);
    expect(jerrek!.explanation).not.toContain('DI bonus');
  });
});
