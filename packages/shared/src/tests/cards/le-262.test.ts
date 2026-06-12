/**
 * @module le-262.test
 *
 * Card test: Black Trolls (le-262)
 * Type: minion-resource-faction (troll, unique, 1 MP, play influence # 11, in-play influence # 0)
 *
 * "Unique. Playable at Cirith Gorgor or Barad-dûr if the influence check is
 *  greater than 10. Once in play, the number required to influence this faction
 *  is 0. If this influence attempt is made by an Orc or Troll leader, you may
 *  place this faction under the control of that leader and not tap the site.
 *  Discard the faction if the leader moves or leaves play. Three or more
 *  factions controlled by the same leader give 2 extra marshalling points.
 *  Standard Modifications: Morgul Orcs (+2), Orcs of Gundabad (-2)."
 *
 * The play threshold "greater than 10" is modeled as `influenceNumber: 11`
 * (the check total must be >= 11). The "Once in play ... is 0" clause is
 * modeled via `inPlayInfluenceNumber: 0`.
 *
 * Engine Support:
 * | # | Card-text rule                                              | Status          | Notes                                   |
 * |---|------------------------------------------------------------|-----------------|-----------------------------------------|
 * | 1 | Unique                                                     | IMPLEMENTED     | `unique: true`                          |
 * | 2 | Playable only at Cirith Gorgor / Barad-dûr, influence # 11 | IMPLEMENTED     | `playableAt.site` match in site.ts      |
 * | 3 | Once in play, number required to influence is 0            | IMPLEMENTED     | `inPlayInfluenceNumber` (CoE rule 8.3)  |
 * | 4 | Orc/Troll leader may place faction under their control,     | NOT IMPLEMENTED | No faction-leader-control mechanic; no  |
 * |   | not tapping the site                                       |                 | "don't tap site" influence override     |
 * | 5 | Discard faction if that leader moves or leaves play        | NOT IMPLEMENTED | No faction→controlling-leader linkage   |
 * | 6 | 3+ factions controlled by same leader give +2 MP           | NOT IMPLEMENTED | No MP grouping by controlling leader    |
 * | 7 | Standard Modification: Orcs of Gundabad (-2)               | IMPLEMENTED     | `controller.inPlay` resolver context    |
 * | 7 | Standard Modification: Morgul Orcs (+2)                    | IMPLEMENTED*    | *modeled; faction not in card pool      |
 *
 * Playable: PARTIALLY — NOT CERTIFIED. The "leader control" mechanic (rules
 * 4–6) is unsupported engine-wide work: there is no concept of a faction being
 * controlled by a specific Orc/Troll leader, no override to leave the site
 * untapped on a successful influence, no trigger discarding the faction when
 * that leader moves/leaves play, and no marshalling-point rule grouping
 * controlled factions by leader. The tests below cover only the standard,
 * implemented influence behaviour (site restriction, play threshold, standard
 * modifications, and in-play re-influence value).
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

const BLACK_TROLLS = 'le-262' as CardDefinitionId;
const ORCS_OF_GUNDABAD = 'le-276' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;       // dúnadan minion character, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;        // orc minion character, DI 0
const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // dark-hold (playable site)
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold (playable site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (NOT a playable site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

describe('Black Trolls (le-262)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Gorgor with baseline need = 11 - DI', () => {
    // Ciryaher (DI 2, no effects) at Cirith Gorgor with Black Trolls in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-attempt is also legal at Barad-dûr (second playable site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('-2 Standard Modification applies when controller has Orcs of Gundabad in play', () => {
    // Orcs of Gundabad in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 11 - 0 = 11.
    const ogInPlay: CardInPlay = {
      instanceId: 'og-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM], cardsInPlay: [ogInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Orcs of Gundabad in play', () => {
    // Orcs of Gundabad is on the opponent's side — controller.inPlay is
    // per-player, so the penalty must not apply. need stays at 11 - 2 = 9.
    const ogInPlay: CardInPlay = {
      instanceId: 'og-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [ogInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influenceable at a site other than Cirith Gorgor / Barad-dûr', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt action.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [CIRYAHER] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
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

  test('opponent can re-influence Black Trolls while in play; value = 0', () => {
    // CoE rule 8.3, final list: "the value required for the influence check on
    // the faction that is already in play". For Black Trolls that value is 0
    // (inPlayInfluenceNumber). PLAYER_2 owns the faction (in cardsInPlay) and
    // PLAYER_1 is the active resource player at Cirith Gorgor.
    const factionInPlay: CardInPlay = {
      instanceId: 'bt-1' as CardInstanceId,
      definitionId: BLACK_TROLLS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
