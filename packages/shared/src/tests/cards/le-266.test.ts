/**
 * @module le-266.test
 *
 * Card test: Grey Mountain Goblins (le-266)
 * Type: minion-resource-faction (orc, unique, 3 MP, influence # 9)
 *
 * "Unique. Playable at Gondmaeglom if the influence check is greater than
 *  8. Once in play, the number required to influence this faction is 0.
 *  Standard Modifications: Orcs of Gundabad (+2), Goblins of Goblin-gate (+2)."
 *
 * The "Once in play, the number required to influence this faction is 0"
 * clause is modeled via the card's `inPlayInfluenceNumber: 0` field. When
 * an opponent attempts to re-influence the faction while it is in play
 * (CoE rule 8.3), that override is used as the comparison value.
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                   |
 * |---|--------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Gondmaeglom                     | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                   | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has OoG       | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | +2 influence check when controller has GoGG      | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | Bonus does NOT apply if opponent has the faction | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 6 | Opponent re-influence while in play (value = 0)  | IMPLEMENTED | `inPlayInfluenceNumber` (CoE rule 8.3)  |
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

const GREY_MOUNTAIN_GOBLINS = 'le-266' as CardDefinitionId;
const ORCS_OF_GUNDABAD = 'le-276' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;            // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;             // orc warrior, DI 0, no effects
const GONDMAEGLOM = 'le-379' as CardDefinitionId;       // ruins-and-lairs
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;      // shadow-hold, not Gondmaeglom

describe('Grey Mountain Goblins (le-266)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Gondmaeglom with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Gondmaeglom with Grey Mountain Goblins
    // in hand. No standard-modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Orcs of Gundabad in play', () => {
    // Same setup but Orcs of Gundabad already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const oogInPlay: CardInPlay = {
      instanceId: 'oog-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR], cardsInPlay: [oogInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('+2 check modifier applies when controller also has Goblins of Goblin-gate in play', () => {
    // Same setup but Goblins of Goblin-gate already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const goggInPlay: CardInPlay = {
      instanceId: 'gogg-1' as CardInstanceId,
      definitionId: GOBLINS_OF_GOBLIN_GATE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR], cardsInPlay: [goggInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('both standard-modification bonuses stack when controller has both factions in play', () => {
    // Orcs of Gundabad (+2) and Goblins of Goblin-gate (+2) both in play.
    // modifier = DI 2 + 2 + 2 = 6; need = 9 - 6 = 3.
    const oogInPlay: CardInPlay = {
      instanceId: 'oog-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const goggInPlay: CardInPlay = {
      instanceId: 'gogg-1' as CardInstanceId,
      definitionId: GOBLINS_OF_GOBLIN_GATE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR], cardsInPlay: [oogInPlay, goggInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(3);
  });

  test('bonus does NOT apply when only the OPPONENT has Orcs of Gundabad in play', () => {
    // OoG is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const oogInPlay: CardInPlay = {
      instanceId: 'oog-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [oogInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influence-able at a site other than Gondmaeglom', () => {
    // Same character, different shadow-hold (Moria). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Grey Mountain Goblins.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
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
        { id: PLAYER_1, companies: [{ site: GONDMAEGLOM, characters: [CIRYAHER] }], hand: [GREY_MOUNTAIN_GOBLINS], siteDeck: [DOL_GULDUR] },
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

  test('opponent can re-influence Grey Mountain Goblins while in play; value = 0', () => {
    // CoE rule 8.3, final list: "the value required for the influence
    // check on the faction that is already in play". For Grey Mountain
    // Goblins the card text sets that value to 0. PLAYER_2 owns the
    // faction (in cardsInPlay) and PLAYER_1 is the active resource player
    // at Gondmaeglom making the re-influence attempt. Opponent-influence
    // attempts require turnNumber > 2 (see site.ts guard).
    const factionInPlay: CardInPlay = {
      instanceId: 'gmg-1' as CardInstanceId,
      definitionId: GREY_MOUNTAIN_GOBLINS,
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
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('opponent CANNOT re-influence Grey Mountain Goblins at a non-Gondmaeglom site', () => {
    // The faction can only be re-influenced at a site matching its
    // playableAt (Gondmaeglom). Here both companies are at a different
    // shadow-hold (Moria) so no opponent-influence-attempt against the
    // faction is emitted.
    const factionInPlay: CardInPlay = {
      instanceId: 'gmg-1' as CardInstanceId,
      definitionId: GREY_MOUNTAIN_GOBLINS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });
});
