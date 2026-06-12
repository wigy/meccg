/**
 * @module le-273.test
 *
 * Card test: Nûrniags (le-273)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Nûrniag Camp if the influence check is greater than 9.
 *  Standard Modifications: Asdriags (+2), Balchoth (-2), Variags of Khand (+2)."
 *
 * Note on the Standard Modifications list: the printed card and the upstream
 * card database read "Nûriags (+2)" for the first modifier, which is an
 * OCR/transcription error — a faction cannot modify the influence check for
 * itself, and the value is reciprocal with Asdriags (as-111), which lists
 * "Nûrniags (+2)" among its own Standard Modifications. The three Khand camp
 * factions (Asdriags, Nûrniags, Variags of Khand) mutually boost each other
 * (+2) and are all antagonised by Balchoth (-2). The first modifier is
 * therefore Asdriags (+2). The card's `text` field has been corrected
 * accordingly.
 *
 * Unlike the orc factions of the same set (e.g. le-277 Orcs of Mirkwood),
 * Nûrniags has NO "Once in play, the number required to influence this
 * faction is 0" clause, so it carries no `inPlayInfluenceNumber` field: an
 * opponent re-influencing it while in play must still meet the printed
 * influence # of 10.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Nûrniag Camp                            | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 10 (greater than 9)                          | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Asdriags          | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | -2 influence check when controller has Balchoth          | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | +2 influence check when controller has Variags of Khand  | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 6 | Modifiers do NOT apply if OPPONENT has those factions    | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 7 | Opponent re-influence while in play uses printed # (10)  | IMPLEMENTED | no `inPlayInfluenceNumber` → influence # |
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

const NURNIAGS = 'le-273' as CardDefinitionId;
const ASDRIAGS = 'as-111' as CardDefinitionId;          // +2 Standard Modification
const BALCHOTH = 'le-260' as CardDefinitionId;          // -2 Standard Modification
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId;  // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const NURNIAG_CAMP = 'le-396' as CardDefinitionId;  // shadow-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (not Nûrniag Camp)

describe('Nûrniags (le-273)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Nûrniag Camp with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Nûrniag Camp with Nûrniags in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 check modifier applies when controller also has Asdriags in play', () => {
    // Asdriags already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const asdriagsInPlay: CardInPlay = {
      instanceId: 'asdriags-1' as CardInstanceId,
      definitionId: ASDRIAGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [asdriagsInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('+2 check modifier applies when controller also has Variags of Khand in play', () => {
    // Variags of Khand in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const variagsInPlay: CardInPlay = {
      instanceId: 'variags-1' as CardInstanceId,
      definitionId: VARIAGS_OF_KHAND,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [variagsInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('-2 check modifier applies when controller has Balchoth in play', () => {
    // Balchoth in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 10 - 0 = 10.
    const balchothInPlay: CardInPlay = {
      instanceId: 'balchoth-1' as CardInstanceId,
      definitionId: BALCHOTH,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [balchothInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Asdriags in play', () => {
    // Asdriags is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const asdriagsInPlay: CardInPlay = {
      instanceId: 'asdriags-1' as CardInstanceId,
      definitionId: ASDRIAGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [asdriagsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Balchoth in play', () => {
    // Balchoth is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const balchothInPlay: CardInPlay = {
      instanceId: 'balchoth-1' as CardInstanceId,
      definitionId: BALCHOTH,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [balchothInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Nûrniag Camp', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Nûrniags.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that the influencingCharacterId field points at
    // Ciryaher — protects against the test passing due to an unrelated
    // character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
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

  test('opponent re-influence while in play uses the printed influence # (10), not 0', () => {
    // Nûrniags has NO "Once in play, the number required to influence this
    // faction is 0" clause, so it carries no `inPlayInfluenceNumber`. The
    // re-influence target therefore falls back to the printed influence #
    // of 10 (contrast with le-277 Orcs of Mirkwood, which sets it to 0).
    const factionInPlay: CardInPlay = {
      instanceId: 'nurn-1' as CardInstanceId,
      definitionId: NURNIAGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: NURNIAG_CAMP, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 10');
  });
});
