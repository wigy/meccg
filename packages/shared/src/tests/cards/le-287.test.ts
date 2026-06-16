/**
 * @module le-287.test
 *
 * Card test: Southrons (le-287)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 9)
 *
 * "Unique. Manifestation of hero Southrons. Playable at Southron Oasis if the
 *  influence check is greater than 8. Standard Modifications: Haradrim (+2),
 *  Asdriags (-2)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique" → `unique: true` (deck-building limit, not an in-game effect).
 *  - "Manifestation of hero Southrons" → a deck-building/sideboard flavour note
 *    marking this minion faction as the minion-side counterpart of the hero
 *    Southrons faction (tw-426 is the matching hero site). It carries no
 *    in-game mechanic, so — like every other certified "Manifestation of …"
 *    faction — it maps to no `effects` entry.
 *  - "Playable at Southron Oasis … greater than 8" → `playableAt.site` plus the
 *    printed influence # of 9 (a check strictly greater than 8 succeeds, i.e.
 *    the number required is 9). Modelled by the shared faction-influence
 *    machinery; `need = influenceNumber(9) - modifiers`.
 *  - "Standard Modifications: Haradrim (+2), Asdriags (-2)" → two
 *    `check-modifier` effects on the influence check, each gated on the
 *    controller having the named faction in play (`controller.inPlay`).
 *
 * Unlike the orc factions of the same set (e.g. le-278 Orcs of Moria), Southrons
 * has NO "Once in play, the number required to influence this faction is 0"
 * clause, so it carries no `inPlayInfluenceNumber`: an opponent re-influencing
 * it while in play must still meet the printed influence # of 9.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Southron Oasis                          | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                           | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Haradrim          | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | -2 influence check when controller has Asdriags          | IMPLEMENTED | `controller.inPlay` resolver context    |
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

const SOUTHRONS = 'le-287' as CardDefinitionId;
const HARADRIM = 'as-63' as CardDefinitionId;    // +2 Standard Modification
const ASDRIAGS = 'as-111' as CardDefinitionId;   // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;          // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;           // orc warrior, DI 0, no effects
const SOUTHRON_OASIS = 'le-404' as CardDefinitionId;  // border-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;        // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // shadow-hold (not Southron Oasis)

describe('Southrons (le-287)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Southron Oasis with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Southron Oasis with Southrons in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Haradrim in play', () => {
    // Haradrim already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const haradrimInPlay: CardInPlay = {
      instanceId: 'haradrim-1' as CardInstanceId,
      definitionId: HARADRIM,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM], cardsInPlay: [haradrimInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('-2 check modifier applies when controller has Asdriags in play', () => {
    // Asdriags in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 9 - 0 = 9.
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
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM], cardsInPlay: [asdriagsInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('both modifiers stack: Haradrim (+2) and Asdriags (-2) cancel out', () => {
    // Both factions in PLAYER_1's cardsInPlay → +2 - 2 = 0 net check modifier.
    // modifier = DI 2 + 0 = 2; need = 9 - 2 = 7 (same as baseline).
    const haradrimInPlay: CardInPlay = {
      instanceId: 'haradrim-1' as CardInstanceId,
      definitionId: HARADRIM,
      status: CardStatus.Untapped,
    };
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
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM], cardsInPlay: [haradrimInPlay, asdriagsInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Haradrim in play', () => {
    // Haradrim is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const haradrimInPlay: CardInPlay = {
      instanceId: 'haradrim-1' as CardInstanceId,
      definitionId: HARADRIM,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [haradrimInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Asdriags in play', () => {
    // Asdriags is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
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
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [asdriagsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Southron Oasis', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Southrons.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [SOUTHRONS], siteDeck: [CARN_DUM] },
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
    // Southrons has NO "Once in play, the number required to influence this
    // faction is 0" clause, so it carries no `inPlayInfluenceNumber`. The
    // re-influence target therefore falls back to the printed influence #
    // of 9 (contrast with le-278 Orcs of Moria, which sets it to 0).
    const factionInPlay: CardInPlay = {
      instanceId: 'southrons-1' as CardInstanceId,
      definitionId: SOUTHRONS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: SOUTHRON_OASIS, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
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
