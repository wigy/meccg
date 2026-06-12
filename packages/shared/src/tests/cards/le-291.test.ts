/**
 * @module le-291.test
 *
 * Card test: Uruk-hai (le-291)
 * Type: minion-resource-faction (orc, unique, 2 MP, influence # 12)
 *
 * "Unique. Playable at Barad-dûr, Cirith Gorgor, or Cirith Ungol if the
 *  influence check is greater than 11. Once in play, the number required to
 *  influence this faction is 0. If this influence attempt is made by an Orc or
 *  Troll leader, you may place this faction under the control of that leader and
 *  not tap the site. Discard the faction if the leader moves or leaves play.
 *  Three or more factions controlled by the same leader give 2 extra
 *  marshalling points. Standard Modifications: Any other Orc faction (-2;
 *  applied only once)."
 *
 * "Playable if the influence check is greater than 11" → influence # 12 (the
 * engine compares `total >= influenceNumber`). "Once in play, the number
 * required to influence this faction is 0" → `inPlayInfluenceNumber: 0`.
 *
 * The "Any other Orc faction (-2)" Standard Modification is phrased as a race
 * category, not a named card, so it cannot reuse the `controller.inPlay` name
 * list used by the Khand-camp factions (le-273 etc.). It is implemented via a
 * new `controller.factionRaces` resolver context (races of factions the
 * influencing player controls in play, excluding the faction being influenced)
 * and a `check-modifier` gated on `{ "controller.factionRaces": "orc" }`. The
 * "applied only once" wording is satisfied automatically: a single
 * check-modifier effect contributes its -2 once regardless of how many other
 * Orc factions are in play.
 *
 * Engine Support:
 * | # | Feature                                                       | Status          | Notes                                       |
 * |---|---------------------------------------------------------------|-----------------|---------------------------------------------|
 * | 1 | Playable only at Barad-dûr / Cirith Gorgor / Cirith Ungol     | IMPLEMENTED     | `playableAt.site` match in site.ts          |
 * | 2 | Influence # 12 (greater than 11)                              | IMPLEMENTED     | shared faction-influence machinery          |
 * | 3 | Once in play, influence # is 0                                | IMPLEMENTED     | `inPlayInfluenceNumber: 0`                  |
 * | 4 | -2 influence check when controller has another Orc faction    | IMPLEMENTED     | `controller.factionRaces` resolver context  |
 * | 5 | -2 does NOT apply for a non-Orc faction / opponent's faction  | IMPLEMENTED     | race-typed, per-player                      |
 * | 6 | Place faction under Orc/Troll leader's control (no site tap)  | NOT IMPLEMENTED | no faction→leader attachment in the engine  |
 * | 7 | Discard the faction if that leader moves or leaves play        | NOT IMPLEMENTED | depends on #6                               |
 * | 8 | 3+ factions controlled by the same leader give +2 MP          | NOT IMPLEMENTED | depends on #6; no per-leader MP scaling     |
 *
 * Playable: PARTIALLY — the Orc/Troll-leader faction-control mechanic (rules
 * 6–8 above) is not implemented in the engine. This card is therefore
 * NOT CERTIFIED. The tests below cover only the implemented rules (1–5).
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

const URUK_HAI = 'le-291' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // other Orc faction → -2
const NURNIAGS = 'le-273' as CardDefinitionId;               // Man faction → no -2

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold (a listed site)
const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // dark-hold (a listed site)
const CIRITH_UNGOL = 'le-362' as CardDefinitionId;  // dark-hold (a listed site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (NOT a listed site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

function orcFactionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Uruk-hai (le-291)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Barad-dûr with baseline need = 12 - DI', () => {
    // Ciryaher (DI 2, no effects) at Barad-dûr with Uruk-hai in hand, no other
    // Orc faction in play → modifier = DI 2. need = influenceNumber(12) - 2 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('influence-attempt is legal at Cirith Gorgor and Cirith Ungol too', () => {
    for (const site of [CIRITH_GORGOR, CIRITH_UNGOL]) {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          { id: PLAYER_1, companies: [{ site, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
          { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
        ],
      });
      const state = { ...base, phaseState: makeSitePhase() };
      const factionInstanceId = state.players[0].hand[0].instanceId;
      const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
      expect(attempt, `playable at ${site as string}`).toBeDefined();
      expect(attempt!.need).toBe(10);
    }
  });

  test('faction is NOT influenceable at a site other than the three listed sites', () => {
    // Goblin-gate is a shadow-hold, not one of Barad-dûr / Cirith Gorgor /
    // Cirith Ungol. The playableAt restriction disqualifies the faction.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Standard Modification: -2 check when controller also has another Orc faction in play', () => {
    // Goblins of Goblin-gate (Orc faction) already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 12 - 0 = 12.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM], cardsInPlay: [orcFactionInPlay(GOBLINS_OF_GOBLIN_GATE, 'goblins-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(12);
  });

  test('Standard Modification does NOT apply for a non-Orc faction (Nûrniags, Man)', () => {
    // Nûrniags is a Man faction → it is not "another Orc faction", so no -2.
    // need stays at baseline 12 - DI(2) = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM], cardsInPlay: [orcFactionInPlay(NURNIAGS, 'nurniags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('Standard Modification does NOT apply when only the OPPONENT has another Orc faction', () => {
    // Goblins of Goblin-gate is on PLAYER_2's side — controller.factionRaces is
    // per-player, so PLAYER_1's influence check is unaffected. need = 12 - 2 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [orcFactionInPlay(GOBLINS_OF_GOBLIN_GATE, 'goblins-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('influence-attempt uses Ciryaher (the only untapped character in company)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
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

  test('opponent re-influence while in play uses inPlayInfluenceNumber 0, not the printed # (12)', () => {
    // "Once in play, the number required to influence this faction is 0." The
    // opponent (PLAYER_1) re-influencing an in-play Uruk-hai targets influence
    // # 0 rather than the printed 12. PLAYER_1 controls no Orc faction of its
    // own, so the -2 Standard Modification does not apply here.
    const factionInPlay = orcFactionInPlay(URUK_HAI, 'uruk-1');
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
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
