/**
 * @module dm-10.test
 *
 * Card test: Firiel (dm-10)
 * Type: minion-character (ringwraith alignment), race dúnadan, agent,
 *       homesite "Pelargir, Vale of Erech"
 * Stats: prowess 3, body 8, mind 6, direct influence 3, MP 2 (character)
 * Skills: sage, diplomat, shadow-magic
 *
 * Card text:
 *   "Unique. Agent. Can use shadow-magic. +2 direct influence against Dúnedain
 *    and factions that can be played in Anfalas, Anórien, Belfalas, Lamedon,
 *    and Lebennin."
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
 * "Unique." / "Agent." / "Can use shadow-magic." are structural (the `unique`
 * flag, the `agent` keyword, and the shadow-magic skill on the card) and carry
 * no extra rule beyond the stat data.
 *
 * Data note: this certification also corrected Firiel's race, which was stored
 * as the accented "dúnadan" — not a valid Race enum value (types/common.ts:
 * Dunadan = 'dunadan') — which silently disabled every race-gated interaction
 * for her, including the standard Dúnedain (+1) influence modification that the
 * Southern-Gondor factions grant a Dúnadan influencer.
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

const FIRIEL = 'dm-10' as CardDefinitionId;

// Southern-Gondor faction playable in one of Firiel's five named regions.
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;   // man, inf# 8, playable at Minas Tirith (Anórien)
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;      // free-hold, Anórien
// Dúnadan faction outside the five regions (tests the "against Dúnedain" clause).
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // dúnadan, inf# 10, playable at Bree
const BREE = 'tw-378' as CardDefinitionId;               // border-hold, Arthedain
// Non-Dúnadan faction outside the five regions (control: no bonus).
const LOSSOTH = 'tw-268' as CardDefinitionId;            // man, inf# 9, no standard modification, at Lossadan Camp
const LOSSADAN_CAMP = 'tw-410' as CardDefinitionId;      // border-hold, Forochel

function firielAttempt(state: ReturnType<typeof buildMinionSitePhaseState>): InfluenceAttemptAction | undefined {
  const firielId = findCharInstanceId(state, RESOURCE_PLAYER, FIRIEL);
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === firielId);
}

describe('Firiel (dm-10)', () => {
  beforeEach(() => resetMint());

  test('+2 DI applies against a faction playable in one of the five named regions', () => {
    // Men of Anórien (inf# 8) is playable at Minas Tirith, which is in Anórien.
    // Firiel (dúnadan, free DI 3) gets: standard Dúnedain (+1) + her region (+2).
    // need = influenceNumber(8) - DI(3) - dunedain(1) - firiel(2) = 2.
    const state = buildMinionSitePhaseState({
      characters: [FIRIEL],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const attempt = firielAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(2);
  });

  test('+2 DI applies against a Dúnadan faction even outside the five regions', () => {
    // Rangers of the North (dúnadan, inf# 10) is playable at Bree (Arthedain —
    // not one of the five regions). The bonus still fires via faction.race.
    // need = influenceNumber(10) - DI(3) - dunedain(1) - firiel(2) = 4.
    const state = buildMinionSitePhaseState({
      characters: [FIRIEL],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const attempt = firielAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('+2 DI does NOT apply against a non-Dúnadan faction outside the five regions', () => {
    // Lossoth (man, inf# 9, no standard modification) is playable at Lossadan
    // Camp (Forochel). Neither the race clause nor the region clause fires.
    // need = influenceNumber(9) - DI(3) = 6. (Were the +2 wrongly applied: 4.)
    const state = buildMinionSitePhaseState({
      characters: [FIRIEL],
      site: LOSSADAN_CAMP,
      hand: [LOSSOTH],
    });

    const attempt = firielAttempt(state);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });
});
