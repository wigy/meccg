/**
 * @module le-289.test
 *
 * Card test: Umbarean Corsairs (le-289)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Gobel Mírlond if the influence check is greater than 8.
 *  Standard Modifications: Black Númenóreans (+2), Southrons (+2)."
 *
 * Notes on the card data:
 * - "Playable at Gobel Mírlond" names a specific site (le-377 / as Gobel
 *   Mírlond) — modeled as `playableAt: [{ site: "Gobel Mírlond" }]`, matched
 *   by `siteDef.name === entry.site` in site.ts. (The data previously held a
 *   truncated "Gobel", which matched no site.)
 * - "if the influence check is greater than 8" → influence # 9: the engine
 *   succeeds when `roll + DI + modifiers >= influenceNumber`.
 * - No "Once in play, the number required to influence this faction is 0"
 *   clause, so no `inPlayInfluenceNumber`: opponent re-influence uses 9.
 * - The Standard Modifications apply only when the *controller* has the
 *   named faction in play (Black Númenóreans as-113 lists "Umbarean
 *   Corsairs (+2)" reciprocally).
 *
 * Engine Support:
 * | # | Feature                                                   | Status      | Notes                                   |
 * |---|-----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Gobel Mírlond                            | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                            | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Black Númenóreans  | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | +2 influence check when controller has Southrons          | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | Modifiers do NOT apply if OPPONENT has those factions     | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 6 | Opponent re-influence while in play uses printed # (9)    | IMPLEMENTED | no `inPlayInfluenceNumber` → influence # |
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
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
} from '../../index.js';

const UMBAREAN_CORSAIRS = 'le-289' as CardDefinitionId;
const BLACK_NUMENOREANS = 'as-113' as CardDefinitionId;   // +2 Standard Modification
const SOUTHRONS = 'le-287' as CardDefinitionId;           // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const GOBEL_MIRLOND = 'le-377' as CardDefinitionId; // border-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (not Gobel Mírlond)

function inPlay(id: string, def: CardDefinitionId): CardInPlay {
  return { instanceId: id as CardInstanceId, definitionId: def, status: CardStatus.Untapped };
}

function setup(opts: {
  site?: CardDefinitionId;
  mine?: CardInPlay[];
  theirs?: CardInPlay[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.site ?? GOBEL_MIRLOND, characters: [CIRYAHER] }], hand: [UMBAREAN_CORSAIRS], siteDeck: [CARN_DUM], cardsInPlay: opts.mine ?? [] },
      { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: opts.theirs ?? [] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('Umbarean Corsairs (le-289)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Gobel Mírlond with baseline need = 9 - DI', () => {
    // need = influenceNumber(9) - DI(2) = 7.
    const state = setup({});
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
    expect(attempt!.influencingCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER));
  });

  test('+2 check modifier applies when controller has Black Númenóreans in play', () => {
    // modifier = DI 2 + 2 = 4; need = 9 - 4 = 5.
    const state = setup({ mine: [inPlay('bn-1', BLACK_NUMENOREANS)] });
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('+2 check modifier applies when controller has Southrons in play', () => {
    const state = setup({ mine: [inPlay('southrons-1', SOUTHRONS)] });
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('both modifiers stack when controller has Black Númenóreans and Southrons', () => {
    // modifier = DI 2 + 2 + 2 = 6; need = 9 - 6 = 3.
    const state = setup({ mine: [inPlay('bn-1', BLACK_NUMENOREANS), inPlay('southrons-1', SOUTHRONS)] });
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(3);
  });

  test('modifiers do NOT apply when only the OPPONENT has the named factions', () => {
    const state = setup({ theirs: [inPlay('bn-1', BLACK_NUMENOREANS), inPlay('southrons-1', SOUTHRONS)] });
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Gobel Mírlond', () => {
    const state = setup({ site: GOBLIN_GATE });
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeUndefined();
  });

  test('opponent re-influence while in play uses the printed influence # (9), not 0', () => {
    const factionInPlay = inPlay('corsairs-1', UMBAREAN_CORSAIRS);
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
