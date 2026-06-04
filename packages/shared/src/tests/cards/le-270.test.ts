/**
 * @module le-270.test
 *
 * Card test: Ice-orcs (le-270)
 * Type: minion-resource-faction (orc, unique, 4 MP, influence # 11)
 *
 * "Unique. Playable at any Ruins & Lairs [{R}] in Forochel or Withered Heath
 *  if the influence check is greater than 10. Once in play, the number
 *  required to influence this faction is 0. Standard Modifications:
 *  Wargs of the Forochel (+2)."
 *
 * Key rules modelled:
 * - `playableAt` restricts to ruins-and-lairs sites in Forochel or Withered Heath,
 *   using a `siteType` entry with a `when: { "site.region": { "$in": [...] } }` condition.
 *   The `site.region` path is populated by `siteMatchesEntry` in legal-actions/site.ts.
 * - `influenceNumber: 11` — "greater than 10" means roll ≥ 11.
 * - `inPlayInfluenceNumber: 0` — once controlled, opponent re-influence threshold = 0.
 * - `check-modifier` (+2 influence when controller has Wargs of the Forochel in play).
 *
 * Engine Support:
 * | # | Feature                                                         | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Playable only at ruins-and-lairs in Forochel or Withered Heath  | IMPLEMENTED |
 * | 2 | Influence # 11 (greater than 10)                                | IMPLEMENTED |
 * | 3 | +2 influence check when controller has Wargs of the Forochel    | IMPLEMENTED |
 * | 4 | Bonus does NOT apply if opponent has Wargs of the Forochel      | IMPLEMENTED |
 * | 5 | Opponent re-influence while in play (value = 0)                 | IMPLEMENTED |
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

const ICE_ORCS = 'le-270' as CardDefinitionId;
const WARGS_OF_THE_FOROCHEL = 'le-293' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;          // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;            // orc warrior, DI 0, no effects

const LOSSADAN_CAIRN = 'le-388' as CardDefinitionId;  // ruins-and-lairs in Forochel
const CAVES_OF_ULUND = 'le-360' as CardDefinitionId;  // ruins-and-lairs in Withered Heath
const GONDMAEGLOM = 'le-379' as CardDefinitionId;     // ruins-and-lairs in Grey Mountain Narrows

const DOL_GULDUR = 'le-367' as CardDefinitionId;      // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // minion haven

describe('Ice-orcs (le-270)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at ruins-and-lairs in Forochel; need = 11 - DI', () => {
    // Ciryaher (DI 2) at Lossadan Cairn (ruins-and-lairs, Forochel).
    // No Wargs of the Forochel in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-attempt is legal at ruins-and-lairs in Withered Heath; need = 11 - DI', () => {
    // Ciryaher (DI 2) at Caves of Ûlund (ruins-and-lairs, Withered Heath).
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAVES_OF_ULUND, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influence-able at ruins-and-lairs outside Forochel and Withered Heath', () => {
    // Gondmaeglom is ruins-and-lairs but is in Grey Mountain Narrows,
    // which is neither Forochel nor Withered Heath.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('+2 check modifier applies when controller has Wargs of the Forochel in play', () => {
    // Wargs of the Forochel in PLAYER_1's cardsInPlay.
    // modifier = DI(2) + check bonus(2) = 4; need = 11 - 4 = 7.
    const wargsInPlay: CardInPlay = {
      instanceId: 'wargs-1' as CardInstanceId,
      definitionId: WARGS_OF_THE_FOROCHEL,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR], cardsInPlay: [wargsInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('bonus does NOT apply when only the OPPONENT has Wargs of the Forochel', () => {
    // Wargs of the Forochel is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const wargsInPlay: CardInPlay = {
      instanceId: 'wargs-1' as CardInstanceId,
      definitionId: WARGS_OF_THE_FOROCHEL,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [wargsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('opponent can re-influence Ice-orcs while in play at a valid site; value = 0', () => {
    // CoE rule 8.3: "the value required for the influence check on the faction
    // that is already in play". Ice-orcs text sets that value to 0.
    // PLAYER_2 owns Ice-orcs; PLAYER_1 is active resource player at Lossadan Cairn.
    const factionInPlay: CardInPlay = {
      instanceId: 'ice-orcs-1' as CardInstanceId,
      definitionId: ICE_ORCS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: LOSSADAN_CAIRN, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('opponent CANNOT re-influence Ice-orcs at a site outside the valid regions', () => {
    // Gondmaeglom is ruins-and-lairs in Grey Mountain Narrows — not in
    // Forochel or Withered Heath. The opponent-influence attempt is not emitted.
    const factionInPlay: CardInPlay = {
      instanceId: 'ice-orcs-1' as CardInstanceId,
      definitionId: ICE_ORCS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: GONDMAEGLOM, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });

  test('influencing character is the untapped character in the company', () => {
    // Verify the influencingCharacterId points at Ciryaher.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [ICE_ORCS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });
});
