/**
 * @module le-260.test
 *
 * Card test: Balchoth (le-260)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Raider-hold if the influence check is greater than 8.
 *  Standard Modifications: Easterlings (+2), Men of Dorwinion (-2)."
 *
 * Notes on the card data:
 * - "Playable at Raider-hold" names a specific site by name ("Raider-hold",
 *   le-399 / as-141), not a site type — modeled as `playableAt: [{ site:
 *   "Raider-hold" }]`, matched by `siteDef.name === entry.site` in site.ts.
 * - "if the influence check is greater than 8" → influence # 9: the engine
 *   succeeds when `roll + DI + modifiers >= influenceNumber`, so "greater
 *   than 8" (i.e. a result of 9 or more) maps to influence # 9.
 * - Balchoth has NO "Once in play, the number required to influence this
 *   faction is 0" clause, so it carries no `inPlayInfluenceNumber`: an
 *   opponent re-influencing it while in play must still meet the printed
 *   influence # of 9.
 * - The Standard Modifications are reciprocal with the named factions'
 *   own lists (Easterlings le-264 lists "Balchoth (+2)", Men of Dorwinion
 *   le-271 lists "Balchoth (-2)"); they apply only when the *controller*
 *   has the named faction in play.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Raider-hold                             | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                           | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Easterlings       | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | -2 influence check when controller has Men of Dorwinion  | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | Modifiers do NOT apply if OPPONENT has those factions    | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 6 | Opponent re-influence while in play uses printed # (9)   | IMPLEMENTED | no `inPlayInfluenceNumber` → influence # |
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

const BALCHOTH = 'le-260' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;          // +2 Standard Modification
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;     // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const RAIDER_HOLD = 'le-399' as CardDefinitionId;   // border-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (not Raider-hold)

describe('Balchoth (le-260)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Raider-hold with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Raider-hold with Balchoth in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Easterlings in play', () => {
    // Easterlings already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const easterlingsInPlay: CardInPlay = {
      instanceId: 'easterlings-1' as CardInstanceId,
      definitionId: EASTERLINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM], cardsInPlay: [easterlingsInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('-2 check modifier applies when controller has Men of Dorwinion in play', () => {
    // Men of Dorwinion in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 9 - 0 = 9.
    const dorwinionInPlay: CardInPlay = {
      instanceId: 'dorwinion-1' as CardInstanceId,
      definitionId: MEN_OF_DORWINION,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM], cardsInPlay: [dorwinionInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('both modifiers combine when controller has Easterlings and Men of Dorwinion', () => {
    // Easterlings (+2) and Men of Dorwinion (-2) both in PLAYER_1's play.
    // modifier = DI 2 + 2 - 2 = 2; need = 9 - 2 = 7 (back to baseline).
    const easterlingsInPlay: CardInPlay = {
      instanceId: 'easterlings-1' as CardInstanceId,
      definitionId: EASTERLINGS,
      status: CardStatus.Untapped,
    };
    const dorwinionInPlay: CardInPlay = {
      instanceId: 'dorwinion-1' as CardInstanceId,
      definitionId: MEN_OF_DORWINION,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM], cardsInPlay: [easterlingsInPlay, dorwinionInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Easterlings in play', () => {
    // Easterlings is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const easterlingsInPlay: CardInPlay = {
      instanceId: 'easterlings-1' as CardInstanceId,
      definitionId: EASTERLINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [easterlingsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Raider-hold', () => {
    // Same character, different site (Goblin-gate, a shadow-hold). The
    // playableAt restriction should disqualify the faction — no
    // influence-attempt action emitted for Balchoth.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [BALCHOTH], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });

  test('opponent re-influence while in play uses the printed influence # (9), not 0', () => {
    // Balchoth has NO "Once in play, the number required to influence this
    // faction is 0" clause, so it carries no `inPlayInfluenceNumber`. The
    // re-influence target therefore falls back to the printed influence #
    // of 9.
    const factionInPlay: CardInPlay = {
      instanceId: 'balchoth-1' as CardInstanceId,
      definitionId: BALCHOTH,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: RAIDER_HOLD, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
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
