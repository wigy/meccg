/**
 * @module le-157.test
 *
 * Card test: War-wolf (le-157)
 * Type: minion-resource-ally
 * Stats: prowess 2, body 7, mind 1, MP 1 (ally). Not unique. Alignment: ringwraith.
 *
 * Card text:
 *   "Playable at any tapped or untapped Ruins & Lairs [{R}] with a Wolf
 *    automatic-attack or at any tapped or untapped Shadow-hold [{S}] with an
 *    Orc automatic-attack."
 *
 * War-wolf is a vanilla ally with no activated abilities — its only special
 * rule is the dual playability restriction. Both clauses gate on the site's
 * own automatic-attack race, and both allow play at an already-tapped site.
 *
 * Engine support:
 * | # | Feature                                                 | Status      | Notes                                                   |
 * |---|---------------------------------------------------------|-------------|---------------------------------------------------------|
 * | 1 | Playable at R&L with a Wolf auto-attack                 | IMPLEMENTED | playableAt siteType ruins-and-lairs, when autoAttack=wolf|
 * | 2 | Playable at Shadow-hold with an Orc auto-attack         | IMPLEMENTED | playableAt siteType shadow-hold, when autoAttack=orc     |
 * | 3 | Playable at already-tapped qualifying sites             | IMPLEMENTED | play-flag: playable-at-tapped-site                       |
 *
 * Fixture alignment: minion-character (ringwraith) with minion sites.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint,
  RESOURCE_PLAYER, PLAYER_1,
  CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, PlayHeroResourceAction } from '../../index.js';

const WAR_WOLF = 'le-157' as CardDefinitionId;

// Minion character — clean fixture with no effects of its own (man, mind 5).
const ASTERNAK = 'le-1' as CardDefinitionId;

// Minion sites by (siteType, automatic-attack race):
const WHITE_TOWERS = 'le-412' as CardDefinitionId; // ruins-and-lairs, Wolves auto-attack
const DIMRILL_DALE = 'le-365' as CardDefinitionId;  // ruins-and-lairs, Orcs auto-attack (no Wolf)
const MORIA = 'le-392' as CardDefinitionId;          // shadow-hold, Orcs auto-attack
const DEAD_MARSHES = 'le-364' as CardDefinitionId;   // shadow-hold, Undead auto-attack (no Orc)
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven (neither R&L nor shadow-hold)

/** Viable play-hero-resource actions for the given War-wolf instance. */
function warWolfPlays(state: ReturnType<typeof buildSitePhaseState>, instId: CardInstanceId) {
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'play-hero-resource')
    .map(a => a.action as PlayHeroResourceAction)
    .filter(a => a.cardInstanceId === instId);
}

describe('War-wolf (le-157)', () => {
  beforeEach(() => resetMint());

  // ─── Clause 1: Ruins & Lairs with a Wolf automatic-attack ───────────────────

  test('War-wolf IS playable at a Ruins & Lairs site with a Wolf automatic-attack', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: WHITE_TOWERS, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId).length).toBeGreaterThanOrEqual(1);
  });

  test('War-wolf IS playable at an already-tapped Ruins & Lairs with a Wolf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK], site: WHITE_TOWERS, hand: [WAR_WOLF],
      siteStatus: CardStatus.Tapped,
    });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId).length).toBeGreaterThanOrEqual(1);
  });

  test('War-wolf is NOT playable at a Ruins & Lairs without a Wolf automatic-attack', () => {
    // Dimrill Dale is ruins-and-lairs but only has an Orcs auto-attack — the
    // R&L clause requires a Wolf, and the Orc clause requires a Shadow-hold.
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: DIMRILL_DALE, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1).filter(a =>
      !a.viable && a.action.type === 'not-playable'
      && (a.action as { cardInstanceId: string }).cardInstanceId === instId,
    );
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Clause 2: Shadow-hold with an Orc automatic-attack ─────────────────────

  test('War-wolf IS playable at a Shadow-hold site with an Orc automatic-attack', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: MORIA, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId).length).toBeGreaterThanOrEqual(1);
  });

  test('War-wolf IS playable at an already-tapped Shadow-hold with an Orc automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK], site: MORIA, hand: [WAR_WOLF],
      siteStatus: CardStatus.Tapped,
    });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId).length).toBeGreaterThanOrEqual(1);
  });

  test('War-wolf is NOT playable at a Shadow-hold without an Orc automatic-attack', () => {
    // Dead Marshes is shadow-hold but has an Undead auto-attack, not Orc.
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: DEAD_MARSHES, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId)).toHaveLength(0);
  });

  // ─── Neither clause: non-qualifying site type ───────────────────────────────

  test('War-wolf is NOT playable at a site that is neither Ruins & Lairs nor Shadow-hold', () => {
    // Dol Guldur is a minion haven — wrong site type for either clause.
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: DOL_GULDUR, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(warWolfPlays(state, instId)).toHaveLength(0);
  });

  // ─── Successful play attaches the ally to a controlling character ────────────

  test('Playing War-wolf at a qualifying Shadow-hold attaches it to the controlling character', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: MORIA, hand: [WAR_WOLF] });
    const instId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const plays = warWolfPlays(state, instId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
    // The action targets an untapped character in the company to control the ally.
    expect(plays[0].attachToCharacterId).toBeDefined();
    expect(plays[0].companyId).toBeDefined();
  });
});
