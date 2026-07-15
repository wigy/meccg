/**
 * @module dm-24.test
 *
 * Card test: Súrion (dm-24)
 * Type: minion-character (ringwraith alignment), race dúnadan, agent,
 *       homesite "Minas Tirith, Pelargir"
 * Stats: prowess 5, body 7, mind 6, direct influence 2, MP 2 (character)
 * Skills: warrior, sage, diplomat
 *
 * Card text:
 *   "Unique. Agent. +2 direct influence against Dúnedain and factions that can
 *    be played in Anfalas, Anórien, Belfalas, Lamedon, and Lebennin."
 *
 * Effect tested — a single stat-modifier (direct-influence +2) whose `when`
 * gate fires on either:
 *   (a) a character influence-check against a Dúnadan target, OR
 *   (b) a faction-influence-check where the faction is Dúnadan by race OR
 *       playable in one of the five Southern-Gondor regions (Anfalas,
 *       Anórien, Belfalas, Lamedon, Lebennin).
 *
 * The faction's playable regions are resolved by the engine from its
 * `playableAt` named sites (each site's `region`), exposed to the DSL as
 * `faction.playableRegions`. The tests drive computeLegalActions and assert
 * on the resulting influence-attempt `need` — no assertions on card JSON.
 *
 * This is the same direct-influence ability as Firiel (dm-10); Súrion differs
 * only in his stats (free DI 2, not 3) and in lacking shadow-magic.
 *
 * "Unique." / "Agent." are structural (the `unique` flag and the `agent`
 * keyword on the card) and carry no extra rule beyond the stat data.
 *
 * Data note: this certification also corrected Súrion's race, which was stored
 * as the accented "dúnadan" — not a valid Race enum value (types/common.ts:
 * Dunadan = 'dunadan') — which silently disabled every race-gated interaction
 * for him.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  buildMinionSitePhaseState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import type {
  CardDefinitionId, InfluenceAttemptAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const SURION = 'dm-24' as CardDefinitionId;

// Southern-Gondor faction playable in one of Súrion's five named regions.
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;   // man, inf# 8, playable at Minas Tirith (Anórien)
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;      // free-hold, Anórien
// Dúnadan faction outside the five regions (tests the "against Dúnedain" clause).
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // dúnadan, inf# 10, playable at Bree
const BREE = 'tw-378' as CardDefinitionId;               // border-hold, Arthedain
// Non-Dúnadan faction outside the five regions (control: no bonus).
const LOSSOTH = 'tw-268' as CardDefinitionId;            // man, inf# 9, no standard modification, at Lossadan Camp
const LOSSADAN_CAMP = 'tw-410' as CardDefinitionId;      // border-hold, Forochel

function surionAttempt(state: ReturnType<typeof buildMinionSitePhaseState>): InfluenceAttemptAction | undefined {
  const surionId = findCharInstanceId(state, RESOURCE_PLAYER, SURION);
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === surionId);
}

describe('Súrion (dm-24)', () => {
  beforeEach(() => resetMint());

  test('+2 DI applies against a faction playable in one of the five named regions', () => {
    // Men of Anórien (inf# 8) is playable at Minas Tirith, which is in Anórien.
    // Súrion (dúnadan, free DI 2) gets: standard Dúnedain (+1) + his region (+2).
    // need = influenceNumber(8) - DI(2) - dunedain(1) - surion(2) = 3.
    const state = buildMinionSitePhaseState({
      characters: [SURION],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const attempt = surionAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(3);
  });

  test('+2 DI applies against a Dúnadan faction even outside the five regions', () => {
    // Rangers of the North (dúnadan, inf# 10) is playable at Bree (Arthedain —
    // not one of the five regions). The bonus still fires via faction.race.
    // need = influenceNumber(10) - DI(2) - dunedain(1) - surion(2) = 5.
    const state = buildMinionSitePhaseState({
      characters: [SURION],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const attempt = surionAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('+2 DI does NOT apply against a non-Dúnadan faction outside the five regions', () => {
    // Lossoth (man, inf# 9, no standard modification) is playable at Lossadan
    // Camp (Forochel). Neither the race clause nor the region clause fires.
    // need = influenceNumber(9) - DI(2) = 7. (Were the +2 wrongly applied: 5.)
    const state = buildMinionSitePhaseState({
      characters: [SURION],
      site: LOSSADAN_CAMP,
      hand: [LOSSOTH],
    });

    const attempt = surionAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });
});
