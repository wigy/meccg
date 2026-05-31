/**
 * @module le-296.test
 *
 * Card test: Woses of the Eryn Vorn (le-296)
 * Type: minion-resource-faction (ringwraith, unique, 3 MP, influence # 12)
 *
 * "Unique. Playable at The Worthy Hills if the influence check is greater than 11."
 *
 * There are no DSL effects. All rules are enforced by structural faction
 * engine support:
 *   - `playableAt.site` restricts influence attempts to The Worthy Hills
 *   - `influenceNumber: 12` sets the threshold (need = 12 - DI)
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                            |
 * |---|------------------------------------------------------|-------------|----------------------------------|
 * | 1 | Playable only at The Worthy Hills                    | IMPLEMENTED | `playableAt.site` match          |
 * | 2 | Influence # 12 (greater than 11)                     | IMPLEMENTED | shared faction-influence machine |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const WOSES_OF_THE_ERYN_VORN = 'le-296' as CardDefinitionId;

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan scout/sage, DI 2, no relevant effects
const LAGDUF = 'le-18' as CardDefinitionId;          // orc warrior, DI 0, no relevant effects
const THE_WORTHY_HILLS = 'le-415' as CardDefinitionId; // ruins-and-lairs, nearest haven Carn Dûm
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven (opponent / sit deck filler)
const MORIA = 'le-392' as CardDefinitionId;          // shadow-hold (not The Worthy Hills)

describe('Woses of the Eryn Vorn (le-296)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at The Worthy Hills with need = 10 (12 - DI 2)', () => {
    // Ciryaher (DI 2) at The Worthy Hills with Woses in hand.
    // need = influenceNumber(12) - DI(2) = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: THE_WORTHY_HILLS, characters: [CIRYAHER] }], hand: [WOSES_OF_THE_ERYN_VORN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('influence-attempt uses Ciryaher as the influencing character', () => {
    // Sanity-check that influencingCharacterId resolves to Ciryaher.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: THE_WORTHY_HILLS, characters: [CIRYAHER] }], hand: [WOSES_OF_THE_ERYN_VORN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });

  test('faction is NOT influenceable at a site other than The Worthy Hills', () => {
    // Same company at Moria (a shadow-hold, but not The Worthy Hills).
    // The playableAt restriction must disqualify the faction entirely.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [WOSES_OF_THE_ERYN_VORN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });
});
