/**
 * @module le-279.test
 *
 * Card test: Orcs of the Ash Mountains (le-279)
 * Type: minion-resource-faction (orc, unique, 1 MP, influence # 9)
 *
 * "Unique. Playable at Cirith Gorgor if the influence check is greater than 8.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions
 *  controlled by the same leader give 2 extra marshalling points. Standard
 *  Modifications: Orcs of the Ephel Dúath (-2), Snaga-hai (+2)."
 *
 * The "Once in play, the number required to influence this faction is 0" clause
 * is modeled via the card's `inPlayInfluenceNumber: 0` field. The Standard
 * Modifications match the controlling player's in-play factions by name
 * ("Orcs of the Ephel Dúath" = LE-280, "Snaga-hai" = le-286 — the authoritative
 * card names per data/cards.json).
 *
 * ⚠️ NOT CERTIFIED. This card carries the Lidless-Eye "leader-controlled
 * faction" sub-rules, which the engine does NOT implement:
 *   - "If this influence attempt is made by an Orc or Troll leader, you may
 *      place this faction under the control of that leader and not tap the
 *      site." — there is no `controlledBy` concept for factions, no option on
 *      `InfluenceAttemptAction` to assign control to a leader, and the
 *      influence resolution always taps the site (`resolveInfluenceAttemptRoll`
 *      in reducer-site.ts).
 *   - "Discard the faction if the leader moves or leaves play." — the
 *      leader-leaves/moves sweeps (`sweepLeaderLeavesCompanyEvents`) only
 *      discard company-bound permanent events, not controlled factions.
 *   - "Three or more factions controlled by the same leader give 2 extra
 *      marshalling points." — no MP recompute path exists for faction control.
 * These three rules form an unimplemented engine subsystem shared by le-279,
 * le-281 and le-282 (all uncertified). The tests below exercise only the
 * implemented rules.
 *
 * Engine Support:
 * | # | Feature                                                       | Status          | Notes                                  |
 * |---|---------------------------------------------------------------|-----------------|----------------------------------------|
 * | 1 | Playable only at Cirith Gorgor                                | IMPLEMENTED     | `playableAt.site` match in site.ts     |
 * | 2 | Influence # 9 (greater than 8)                                | IMPLEMENTED     | shared faction-influence machinery     |
 * | 3 | +2 influence check when controller has Snaga-hai              | IMPLEMENTED     | `controller.inPlay` resolver context   |
 * | 4 | -2 influence check when controller has Orcs of the Ephel Dúath| IMPLEMENTED     | `controller.inPlay` resolver context   |
 * | 5 | Modifiers do NOT apply if opponent has those factions         | IMPLEMENTED     | `controller.inPlay` is per-player      |
 * | 6 | Opponent re-influence while in play (value = 0)               | IMPLEMENTED     | `inPlayInfluenceNumber` (CoE rule 8.3) |
 * | 7 | Place under Orc/Troll leader control, do not tap site         | NOT IMPLEMENTED | no faction `controlledBy`              |
 * | 8 | Discard faction when controlling leader moves / leaves play   | NOT IMPLEMENTED | no faction-control sweep               |
 * | 9 | 3+ factions by same leader → +2 MP                            | NOT IMPLEMENTED | no MP recompute for faction control    |
 *
 * Playable: PARTIALLY (rules 7-9 unimplemented) — NOT CERTIFIED
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

const ORCS_OF_THE_ASH_MOUNTAINS = 'le-279' as CardDefinitionId;
const SNAGA_HAI = 'le-286' as CardDefinitionId;        // +2 Standard Modification

const LAGDUF = 'le-18' as CardDefinitionId;            // orc warrior, DI 0, no effects
const GORBAG = 'le-11' as CardDefinitionId;            // orc, opponent-side character
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;    // dark-hold (the playableAt site)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // minion haven
const BARAD_DUR = 'le-352' as CardDefinitionId;        // dark-hold (NOT Cirith Gorgor)

describe('Orcs of the Ash Mountains (le-279)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Gorgor with baseline need = 9 - DI', () => {
    // Lagduf (DI 0, no effects) at Cirith Gorgor with the faction in hand.
    // No Standard Modification factions in play → modifier = DI 0.
    // need = influenceNumber(9) - DI(0) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 check modifier applies when controller also has Snaga-hai in play', () => {
    // Snaga-hai already in PLAYER_1's cardsInPlay.
    // modifier = DI 0 + check bonus 2 = 2; need = 9 - 2 = 7.
    const snagaInPlay: CardInPlay = {
      instanceId: 'snaga-1' as CardInstanceId,
      definitionId: SNAGA_HAI,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [MINAS_MORGUL], cardsInPlay: [snagaInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Snaga-hai in play', () => {
    // Snaga-hai is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 0 = 9.
    const snagaInPlay: CardInPlay = {
      instanceId: 'snaga-1' as CardInstanceId,
      definitionId: SNAGA_HAI,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL], cardsInPlay: [snagaInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influenceable at a site other than Cirith Gorgor', () => {
    // Same character, different dark-hold (Barad-dûr). The playableAt
    // restriction should disqualify the faction — no influence-attempt action
    // emitted for Orcs of the Ash Mountains.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [LAGDUF] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Lagduf (only untapped character in company)', () => {
    // Sanity check that the influencingCharacterId field points at Lagduf —
    // protects against the test passing due to an unrelated character being
    // picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(lagdufId);
  });

  test('opponent can re-influence Orcs of the Ash Mountains while in play; value = 0', () => {
    // CoE rule 8.3: the comparison value for a faction already in play is its
    // in-play influence number. For Orcs of the Ash Mountains the card text
    // sets that value to 0 (`inPlayInfluenceNumber: 0`). PLAYER_2 owns the
    // faction; PLAYER_1 is the active resource player at Cirith Gorgor making
    // the re-influence attempt.
    const factionInPlay: CardInPlay = {
      instanceId: 'oam-1' as CardInstanceId,
      definitionId: ORCS_OF_THE_ASH_MOUNTAINS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: CIRITH_GORGOR, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL], cardsInPlay: [factionInPlay] },
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
