/**
 * @module as-113.test
 *
 * Card test: Black Númenóreans (as-113)
 * Type: minion-resource-faction (dúnadan, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Gobel Mírlond if the influence check is greater than 8.
 *  Standard Modifications: Umbarean Corsairs (+2)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique" → `unique: true` (deck-building limit, not an in-game effect).
 *  - "Playable at Gobel Mírlond … greater than 8" → `playableAt.site` plus the
 *    printed influence # of 9 (a check strictly greater than 8 succeeds).
 *    Modelled by the shared faction-influence machinery;
 *    `need = influenceNumber(9) - modifiers`.
 *  - "Standard Modifications: Umbarean Corsairs (+2)" → a `check-modifier`
 *    effect on the influence check, gated on the controller having Umbarean
 *    Corsairs in play (`controller.inPlay`).
 *
 * No "Once in play, the number required to influence this faction is 0"
 * clause, so no `inPlayInfluenceNumber`: opponent re-influence uses 9.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Gobel Mírlond                           | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                           | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Umbarean Corsairs | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | Modifier does NOT apply if OPPONENT has the Corsairs     | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 5 | Opponent re-influence while in play uses printed # (9)   | IMPLEMENTED | no `inPlayInfluenceNumber` → influence # |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const BLACK_NUMENOREANS = 'as-113' as CardDefinitionId;
const UMBAREAN_CORSAIRS = 'le-289' as CardDefinitionId;  // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;          // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;           // orc warrior, DI 0, no effects
const GOBEL_MIRLOND = 'le-377' as CardDefinitionId;   // border-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;        // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // shadow-hold (not Gobel Mírlond)

function corsairsInPlay(): CardInPlay {
  return {
    instanceId: 'corsairs-1' as CardInstanceId,
    definitionId: UMBAREAN_CORSAIRS,
    status: CardStatus.Untapped,
  };
}

describe('Black Númenóreans (as-113)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Gobel Mírlond with baseline need = 9 - DI', () => {
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBEL_MIRLOND, characters: [CIRYAHER] }], hand: [BLACK_NUMENOREANS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
    expect(attempt!.influencingCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER));
  });

  test('+2 check modifier applies when controller has Umbarean Corsairs in play', () => {
    // modifier = DI 2 + 2 = 4; need = 9 - 4 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBEL_MIRLOND, characters: [CIRYAHER] }], hand: [BLACK_NUMENOREANS], siteDeck: [CARN_DUM], cardsInPlay: [corsairsInPlay()] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Umbarean Corsairs in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBEL_MIRLOND, characters: [CIRYAHER] }], hand: [BLACK_NUMENOREANS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [corsairsInPlay()] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Gobel Mírlond', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [BLACK_NUMENOREANS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('opponent re-influence while in play uses the printed influence # (9)', () => {
    const factionInPlay: CardInPlay = {
      instanceId: 'black-numenoreans-1' as CardInstanceId,
      definitionId: BLACK_NUMENOREANS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBEL_MIRLOND, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: GOBEL_MIRLOND, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 9');
  });
});
