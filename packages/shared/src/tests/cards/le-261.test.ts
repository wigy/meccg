/**
 * @module le-261.test
 *
 * Card test: Beornings (le-261)
 * Type: minion-resource-faction (man, unique, 3 MP, influence # 10)
 *
 * "Unique. Manifestation of hero Beornings. Playable at Beorn's House if the
 *  influence check is greater than 9."
 *
 * Rule-by-rule interpretation:
 *  - "Unique" → `unique: true` (deck-building limit, not an in-game effect).
 *  - "Manifestation of hero Beornings" → this minion faction and the hero
 *    Beornings faction (tw-197) are the same unique entity. Both cards carry
 *    the identical printed name "Beornings", so the engine's name-based
 *    in-play uniqueness check (`countCopiesInPlay`, scanning both players)
 *    already treats them as one unique faction: if either manifestation is in
 *    play anywhere, the other cannot be influenced.
 *  - "Playable at Beorn's House … greater than 9" → `playableAt.site` (le-354,
 *    printed name "Beorn's House") plus the printed influence # of 10 (a check
 *    strictly greater than 9 succeeds). Modelled by the shared
 *    faction-influence machinery; `need = influenceNumber(10) - modifiers`.
 *
 * Unlike its Standard-Modification-bearing sibling Variags of Khand (le-292),
 * Beornings has no Standard Modifications, no leader-control, and no in-play
 * influence override — so its `effects` array is empty and every rule is
 * handled structurally by the engine.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                              |
 * |---|------------------------------------------------------|-------------|------------------------------------|
 * | 1 | Playable only at Beorn's House                       | IMPLEMENTED | `playableAt.site` match in site.ts |
 * | 2 | Influence # 10 (greater than 9)                      | IMPLEMENTED | shared faction-influence machinery |
 * | 3 | Manifestation shares uniqueness with hero (tw-197)   | IMPLEMENTED | name-based `countCopiesInPlay`     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, addCardInPlay,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const BEORNINGS = 'le-261' as CardDefinitionId;        // this card (minion Beornings)
const HERO_BEORNINGS = 'tw-197' as CardDefinitionId;   // hero Beornings — same unique entity

const CIRYAHER = 'le-6' as CardDefinitionId;           // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;            // orc warrior, DI 0, no effects
const BEORNS_HOUSE = 'le-354' as CardDefinitionId;     // free-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;         // minion haven (site-deck filler)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;      // shadow-hold (not Beorn's House)

describe('Beornings (le-261)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Beorn\'s House with baseline need = 8 (10 - DI 2)', () => {
    // Ciryaher (DI 2, no effects) at Beorn's House with Beornings in hand.
    // No modifiers → need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [CIRYAHER] }], hand: [BEORNINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Beorn\'s House', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt action
    // emitted for Beornings.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [BEORNINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that influencingCharacterId points at Ciryaher — protects
    // against the test passing due to an unrelated character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [CIRYAHER] }], hand: [BEORNINGS], siteDeck: [CARN_DUM] },
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

  test('Manifestation: not influenceable while hero Beornings (tw-197) is already in play', () => {
    // The opponent already has the hero Beornings faction in play. Because
    // minion Beornings is a "Manifestation of hero Beornings" — the same
    // unique entity, sharing the printed name "Beornings" — the minion player
    // cannot influence it: the name-based in-play uniqueness check (across both
    // players) sees a copy already in play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [CIRYAHER] }], hand: [BEORNINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    // Hero Beornings in the opponent's play area (same unique entity as le-261).
    const withHeroBeornings = addCardInPlay(base, 1, HERO_BEORNINGS);
    const state = { ...withHeroBeornings, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation: influenceable again once no Beornings is in play', () => {
    // Same setup as above but WITHOUT the hero Beornings in play — the
    // uniqueness gate no longer fires and the attempt is offered. This pins
    // that the previous block is caused by the manifestation-in-play, not the
    // base setup.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [CIRYAHER] }], hand: [BEORNINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
  });
});
